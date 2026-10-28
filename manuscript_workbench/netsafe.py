"""Safe URL fetching for Import URL: refuses local/private/internal targets and checks every redirect hop."""
from __future__ import annotations

import ipaddress
import socket
import urllib.parse
from typing import Any, List, Tuple

from .config import MAX_IMPORT_REDIRECTS, MAX_URL_IMPORT_BYTES
from .deps import requests


BLOCKED_IMPORT_MESSAGE = "Local, private, and internal addresses are blocked for URL import."


def _resolve_host(hostname: str, port: int) -> List[str]:
    """Addresses a hostname resolves to. A separate function so tests can run without DNS."""
    infos = socket.getaddrinfo(hostname, port, proto=socket.IPPROTO_TCP)
    return sorted({str(info[4][0]) for info in infos})


def _ip_is_public(ip: Any) -> bool:
    mapped = getattr(ip, "ipv4_mapped", None)
    if mapped is not None:
        ip = mapped
    return not (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved or ip.is_unspecified)


def _literal_ip(host: str) -> Any:
    """Parse a host as an IP address, including the legacy spellings the OS resolver accepts
    (127.1, 2130706433, 0x7f.0.0.1, 0177.0.0.1). Returns None when the host is a name."""
    try:
        return ipaddress.ip_address(host)
    except ValueError:
        pass
    try:
        return ipaddress.ip_address(socket.inet_ntoa(socket.inet_aton(host)))
    except (OSError, ValueError):
        return None


def is_blocked_import_host(hostname: str) -> bool:
    """Syntactic check: localhost names and literal addresses (in any spelling) that are not public."""
    host = (hostname or "").strip().lower().rstrip(".").strip("[]")
    if not host or host == "localhost" or host.endswith(".localhost"):
        return True
    ip = _literal_ip(host.split("%", 1)[0])
    return ip is not None and not _ip_is_public(ip)


def assert_public_host(hostname: str, port: int) -> None:
    """Refuse hosts that are, or resolve to, local/private/internal addresses.

    Residual risk (documented): DNS can answer differently between this check and the actual connection
    (DNS rebinding). The server only listens on loopback, so this is a best-effort guard.
    """
    host = (hostname or "").strip()
    if is_blocked_import_host(host):
        raise ValueError(BLOCKED_IMPORT_MESSAGE)
    if _literal_ip(host.strip("[]").split("%", 1)[0]) is not None:
        return  # a public literal address: nothing to resolve
    try:
        addresses = _resolve_host(host, port)
    except OSError as exc:
        raise ValueError(f"Could not resolve host: {host}") from exc
    if not addresses:
        raise ValueError(f"Could not resolve host: {host}")
    for address in addresses:
        if is_blocked_import_host(address):
            raise ValueError(BLOCKED_IMPORT_MESSAGE)


def validate_import_url(raw_url: str) -> str:
    url = (raw_url or "").strip()
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("Use a full http:// or https:// URL.")
    if parsed.username or parsed.password:
        raise ValueError("URLs with embedded usernames or passwords are not supported.")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    assert_public_host(parsed.hostname or "", port)
    return urllib.parse.urlunparse(parsed)


def fetch_url_bytes(url: str) -> Tuple[bytes, str, str]:
    if requests is None:
        raise RuntimeError("requests is not installed. Run: pip install -r requirements.txt")
    headers = {
        "User-Agent": "ManuscriptWorkbench/1.0 (+local import)",
        "Accept": "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5",
    }
    # Redirects are followed by hand so that every hop is validated *before* it is requested.
    current = validate_import_url(url)
    for _hop in range(MAX_IMPORT_REDIRECTS + 1):
        with requests.get(current, headers=headers, timeout=(8, 25), stream=True, allow_redirects=False) as resp:
            if resp.status_code in (301, 302, 303, 307, 308):
                location = resp.headers.get("Location")
                if not location:
                    raise ValueError("The server sent a redirect without a Location header.")
                current = validate_import_url(urllib.parse.urljoin(current, location))
                continue
            resp.raise_for_status()
            content_type = resp.headers.get("Content-Type", "")
            chunks: List[bytes] = []
            total = 0
            for chunk in resp.iter_content(chunk_size=65536):
                if not chunk:
                    continue
                total += len(chunk)
                if total > MAX_URL_IMPORT_BYTES:
                    raise ValueError("URL response is too large to import safely.")
                chunks.append(chunk)
            return b"".join(chunks), current, content_type
    raise ValueError("Too many redirects.")
