"""Entry point of the frozen server that the desktop app starts (see electron/backend.spec)."""
import sys

from manuscript_workbench import desktop_host

if __name__ == "__main__":
    sys.exit(desktop_host.main(sys.argv[1:]))
