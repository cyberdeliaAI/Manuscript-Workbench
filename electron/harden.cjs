'use strict';
// After packing: turn off the Electron features this app does not use (run as Node, Node CLI flags, loading code
// from outside the asar archive).
const path = require('node:path');

module.exports = async function harden(context) {
  const { flipFuses, FuseVersion, FuseV1Options } = await import('@electron/fuses');
  const name = context.packager.appInfo.productFilename;
  const executable =
    context.electronPlatformName === 'darwin'
      ? path.join(context.appOutDir, `${name}.app`)
      : path.join(
          context.appOutDir,
          context.electronPlatformName === 'win32' ? `${name}.exe` : context.packager.executableName,
        );
  await flipFuses(executable, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });
};
