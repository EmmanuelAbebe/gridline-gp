The **phone-wheel** app for Android: your phone as a tilt steering wheel for Gridline GP, without a browser.

## Install
1. Download the `.apk` below on the phone (or copy it over).
2. Open it. Android asks once to allow installs from this source (your browser or file manager): allow it, then install.
3. On the PC: Gridline GP → Settings → Controller → **Connect phone**.
4. **USB:** USB debugging on, adb on the PC, plug the phone in: the app connects by itself (no code).
   **Wi-Fi:** in the app pick your PC from the list (same network), enter the **pairing code** the game shows. No list?
   Scan the game's QR code, or type the PC's address. Then START DRIVING.

The app talks to the game over your local network only (plain WebSocket, guarded by the pairing code). The browser page
(scan the QR code with the phone's camera) still works as before.

## Known issues
- Not on the Play Store: Android warns about an app from an unknown source. The APK is signed with the project's own key.

Check the download: `SHA256SUMS.txt`.
