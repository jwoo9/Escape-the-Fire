import Foundation
import CoreLocation
import React

@objc(IBeaconRanging)
class IBeaconRanging: RCTEventEmitter, CLLocationManagerDelegate {

    private var locationManager: CLLocationManager!
    private var beaconRegion: CLBeaconRegion?
    private var beaconConstraint: CLBeaconIdentityConstraint?
    private var isRanging = false
    private var hasListeners = false

    override init() {
        super.init()
        DispatchQueue.main.async {
            self.locationManager = CLLocationManager()
            self.locationManager.delegate = self
        }
    }

    override static func requiresMainQueueSetup() -> Bool {
        return true
    }

    override func supportedEvents() -> [String]! {
        return ["onBeaconsRanged", "onAuthorizationChanged", "onError"]
    }

    override func startObserving() {
        hasListeners = true
    }

    override func stopObserving() {
        hasListeners = false
    }

    // MARK: - JS-Exposed Methods

    @objc(requestPermission:rejecter:)
    func requestPermission(_ resolve: @escaping RCTPromiseResolveBlock,
                           rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            let status: CLAuthorizationStatus
            if #available(iOS 14.0, *) {
                status = self.locationManager.authorizationStatus
            } else {
                status = CLLocationManager.authorizationStatus()
            }

            if status == .notDetermined {
                self.locationManager.requestWhenInUseAuthorization()
                resolve("requested")
            } else if status == .authorizedWhenInUse || status == .authorizedAlways {
                resolve("granted")
            } else {
                resolve("denied")
            }
        }
    }

    @objc(startRanging:resolver:rejecter:)
    func startRanging(_ uuidString: String,
                      resolver resolve: @escaping RCTPromiseResolveBlock,
                      rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            guard let uuid = UUID(uuidString: uuidString) else {
                reject("INVALID_UUID", "Invalid UUID string: \(uuidString)", nil)
                return
            }

            // Stop any existing ranging
            self.stopRangingInternal()

            if #available(iOS 13.0, *) {
                let constraint = CLBeaconIdentityConstraint(uuid: uuid)
                self.beaconConstraint = constraint
                self.locationManager.startRangingBeacons(satisfying: constraint)
            } else {
                let region = CLBeaconRegion(proximityUUID: uuid, identifier: "EscapeTheFireRegion")
                self.beaconRegion = region
                self.locationManager.startRangingBeacons(in: region)
            }

            self.isRanging = true
            NSLog("[IBeaconRanging] Started ranging for UUID: \(uuidString)")
            resolve(true)
        }
    }

    @objc(stopRanging:rejecter:)
    func stopRanging(_ resolve: @escaping RCTPromiseResolveBlock,
                     rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            self.stopRangingInternal()
            resolve(true)
        }
    }

    private func stopRangingInternal() {
        if !isRanging { return }
        if #available(iOS 13.0, *), let constraint = self.beaconConstraint {
            self.locationManager.stopRangingBeacons(satisfying: constraint)
            self.beaconConstraint = nil
        } else if let region = self.beaconRegion {
            self.locationManager.stopRangingBeacons(in: region)
            self.beaconRegion = nil
        }
        self.isRanging = false
        NSLog("[IBeaconRanging] Stopped ranging")
    }

    // MARK: - CLLocationManagerDelegate

    @available(iOS 13.0, *)
    func locationManager(_ manager: CLLocationManager,
                         didRange beacons: [CLBeacon],
                         satisfying beaconConstraint: CLBeaconIdentityConstraint) {
        self.emitBeacons(beacons)
    }

    // Older API fallback for iOS 12 and below
    func locationManager(_ manager: CLLocationManager,
                         didRangeBeacons beacons: [CLBeacon],
                         in region: CLBeaconRegion) {
        self.emitBeacons(beacons)
    }

    private func emitBeacons(_ beacons: [CLBeacon]) {
        guard hasListeners else { return }

        let beaconData: [[String: Any]] = beacons.map { beacon in
            let proximityString: String
            switch beacon.proximity {
            case .immediate: proximityString = "immediate"
            case .near:      proximityString = "near"
            case .far:       proximityString = "far"
            default:         proximityString = "unknown"
            }

            return [
                "uuid": beacon.uuid.uuidString,
                "major": beacon.major.intValue,
                "minor": beacon.minor.intValue,
                "rssi": beacon.rssi,
                "accuracy": beacon.accuracy,
                "proximity": proximityString,
                "timestamp": Date().timeIntervalSince1970 * 1000
            ]
        }

        self.sendEvent(withName: "onBeaconsRanged", body: ["beacons": beaconData])
    }

    func locationManager(_ manager: CLLocationManager,
                         didChangeAuthorization status: CLAuthorizationStatus) {
        let statusString: String
        switch status {
        case .notDetermined:       statusString = "notDetermined"
        case .restricted:          statusString = "restricted"
        case .denied:              statusString = "denied"
        case .authorizedAlways:    statusString = "authorizedAlways"
        case .authorizedWhenInUse: statusString = "authorizedWhenInUse"
        @unknown default:          statusString = "unknown"
        }
        if hasListeners {
            self.sendEvent(withName: "onAuthorizationChanged", body: ["status": statusString])
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        NSLog("[IBeaconRanging] Error: \(error.localizedDescription)")
        if hasListeners {
            self.sendEvent(withName: "onError", body: ["message": error.localizedDescription])
        }
    }
}
