'use strict';

// Selected by `tools/build_desktop.py --sign-macos`; ordinary builds keep package.json's ad-hoc identity.
const path = require('node:path');
const { build } = require('../electron/package.json');
const mac = { ...build.mac };
delete mac.identity; // use the Developer ID imported from CSC_LINK, never the ad-hoc identity

module.exports = {
  ...build,
  mac: {
    ...mac,
    forceCodeSigning: true, // fail the macOS build when it cannot be signed; Windows and Linux builds are not signed
    type: 'distribution',
    hardenedRuntime: true,
    entitlements: path.join(__dirname, 'entitlements.mac.plist'),
    entitlementsInherit: path.join(__dirname, 'entitlements.mac.plist'),
    notarize: true,
  },
};
