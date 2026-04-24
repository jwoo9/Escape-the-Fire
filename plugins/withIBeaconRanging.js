/**
 * Expo Config Plugin — iBeacon Ranging (iOS)
 *
 * Registers a native Swift module that uses CoreLocation to range iBeacons.
 * This is required because react-native-ble-plx cannot see iBeacon advertisements
 * on iOS (Apple restricts iBeacon data to the CoreLocation API).
 *
 * This plugin:
 *   1. Copies IBeaconRanging.swift and IBeaconRanging.m into the iOS project
 *   2. Adds them to the Xcode project's sources build phase
 *   3. Ensures the bridging header exists (for mixed Swift + Obj-C)
 *   4. Adds required Info.plist keys for location/beacon permissions
 */

const { withDangerousMod, withInfoPlist, withXcodeProject } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SWIFT_FILE_NAME = 'IBeaconRanging.swift';
const OBJC_FILE_NAME = 'IBeaconRanging.m';
const BRIDGING_HEADER_NAME = 'EmergencyNav-Bridging-Header.h';

function withIBeaconRangingSourceFiles(config) {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const iosRoot = config.modRequest.platformProjectRoot;
      const projectName = config.modRequest.projectName || 'EmergencyNav';
      const targetDir = path.join(iosRoot, projectName);

      // Source files are expected to be in the project's `modules/ibeacon-ranging/ios/` folder
      const sourceDir = path.join(
        config.modRequest.projectRoot,
        'modules',
        'ibeacon-ranging',
        'ios'
      );

      if (!fs.existsSync(sourceDir)) {
        console.warn(
          `[withIBeaconRanging] Source directory not found: ${sourceDir}. Skipping file copy.`
        );
        return config;
      }

      // Copy Swift file
      const swiftSrc = path.join(sourceDir, SWIFT_FILE_NAME);
      const swiftDst = path.join(targetDir, SWIFT_FILE_NAME);
      if (fs.existsSync(swiftSrc)) {
        fs.copyFileSync(swiftSrc, swiftDst);
        console.log(`[withIBeaconRanging] Copied ${SWIFT_FILE_NAME}`);
      }

      // Copy Obj-C bridge file
      const objcSrc = path.join(sourceDir, OBJC_FILE_NAME);
      const objcDst = path.join(targetDir, OBJC_FILE_NAME);
      if (fs.existsSync(objcSrc)) {
        fs.copyFileSync(objcSrc, objcDst);
        console.log(`[withIBeaconRanging] Copied ${OBJC_FILE_NAME}`);
      }

      // Ensure bridging header exists
      const bridgingHeaderPath = path.join(targetDir, BRIDGING_HEADER_NAME);
      if (!fs.existsSync(bridgingHeaderPath)) {
        fs.writeFileSync(
          bridgingHeaderPath,
          `//\n//  ${BRIDGING_HEADER_NAME}\n//\n\n#import <React/RCTBridgeModule.h>\n#import <React/RCTEventEmitter.h>\n`
        );
        console.log(`[withIBeaconRanging] Created bridging header`);
      }

      return config;
    },
  ]);
}

function withIBeaconRangingXcodeProject(config) {
  return withXcodeProject(config, (config) => {
    const xcodeProject = config.modResults;
    const projectName = config.modRequest.projectName || 'EmergencyNav';

    // Add Swift file to project
    const swiftFilePath = `${projectName}/${SWIFT_FILE_NAME}`;
    const objcFilePath = `${projectName}/${OBJC_FILE_NAME}`;
    const bridgingHeaderPath = `${projectName}/${BRIDGING_HEADER_NAME}`;

    // Helper to add a file to the project if it isn't already there
    function addFileIfMissing(filePath) {
      const existing = xcodeProject.hasFile(filePath);
      if (existing) {
        console.log(`[withIBeaconRanging] Already in project: ${filePath}`);
        return;
      }
      try {
        xcodeProject.addSourceFile(filePath, { target: xcodeProject.getFirstTarget().uuid });
        console.log(`[withIBeaconRanging] Added to Xcode project: ${filePath}`);
      } catch (e) {
        console.warn(`[withIBeaconRanging] Failed to add ${filePath}:`, e.message);
      }
    }

    addFileIfMissing(swiftFilePath);
    addFileIfMissing(objcFilePath);

    // Set bridging header in build settings
    const buildConfigurations = xcodeProject.pbxXCBuildConfigurationSection();
    for (const key in buildConfigurations) {
      const config = buildConfigurations[key];
      if (config.buildSettings && config.buildSettings.PRODUCT_NAME) {
        config.buildSettings.SWIFT_OBJC_BRIDGING_HEADER = bridgingHeaderPath;
        config.buildSettings.SWIFT_VERSION = config.buildSettings.SWIFT_VERSION || '5.0';
        config.buildSettings.CLANG_ENABLE_MODULES = 'YES';
      }
    }

    return config;
  });
}

function withIBeaconRangingInfoPlist(config) {
  return withInfoPlist(config, (config) => {
    // These may already be set by app.json, but we ensure they exist.
    if (!config.modResults.NSLocationWhenInUseUsageDescription) {
      config.modResults.NSLocationWhenInUseUsageDescription =
        'This app uses your location to detect BLE beacons for indoor positioning during emergency evacuations.';
    }
    if (!config.modResults.NSBluetoothAlwaysUsageDescription) {
      config.modResults.NSBluetoothAlwaysUsageDescription =
        'This app uses Bluetooth to detect BLE beacons for indoor positioning.';
    }
    return config;
  });
}

module.exports = function withIBeaconRanging(config) {
  config = withIBeaconRangingSourceFiles(config);
  config = withIBeaconRangingXcodeProject(config);
  config = withIBeaconRangingInfoPlist(config);
  return config;
};
