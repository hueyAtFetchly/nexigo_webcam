# NexiGo N680E Pro — Mac Settings Software Context

## Situation
- Hardware: NexiGo **N680E Pro** webcam, purchased today.
- OS: macOS.
- Problem: Downloaded the **App Store** version of the NexiGo Webcam Settings app. All controls in the first tab (**Adjustments** — Brightness, Contrast, White Balance, etc.) are **grayed out / disabled**.
- Already tried: Deleted the app and restarted the computer, intending to install a direct `.dmg` instead.
- Blocker: Every link found points to the App Store version. Could not locate a direct download.

## Key finding — the direct (non–App Store) download exists
NexiGo's official support/download page (`https://www.nexigo.com/pages/support-and-download`)
lists the Mac software with **two** links in the row
**"Webcam Settings (For MAC Only), V1.1"**:

- **Download 1 (direct / non–App Store):** https://bit.ly/MacSoftwareDownload
- Download 2 (App Store — the problematic one): https://apps.apple.com/us/app/nexigo-webcam-settings/id1568831522

> Note: The bit.ly link is an official NexiGo-created short URL. The final file
> destination was not independently verified (network restrictions during research),
> but it is sourced directly from NexiGo's own page, not a third party.

## Important caveat on the symptom
"All Adjustments grayed out at once" is more often a **camera-not-acquired** issue
than an App-Store-vs-DMG issue. The N680E is an autofocus model, so brightness /
contrast / white balance should all be adjustable. Check these first:

1. **Start the live preview.** The webcam must be selected in the device dropdown,
   then click **Preview**. Sliders typically stay disabled until a live feed is running.
2. **Release the camera from other apps.** Quit Zoom, Teams, FaceTime, Photo Booth,
   browser tabs, etc. Only one app can hold the camera at a time.
3. **Grant macOS camera permission.** System Settings → Privacy & Security → Camera →
   enable the NexiGo app. Fully quit and relaunch the app after granting.

## Other reference info
- User manuals: https://www.nexipc.com/pages/nexigo-manuals
- App user guide (Google Drive): https://drive.google.com/file/d/1Nv7pSkUPJxzSvBHXPoYoMnsJJV4jTRHo/view
- The download page notes not all settings are adjustable on every model (e.g. fixed-focus
  models like N60/N660). N680E is autofocus, so this caveat should not apply.

## NexiGo support
- Email: cs@nexigo.com
- Phone: +1 (458) 215-6088
- Hours: Mon–Fri 9:00AM–5:00PM PST

## Suggested next steps / open tasks
- [ ] Install via Download 1 (direct link); confirm whether it's a `.dmg`.
- [ ] On launch: select device → click Preview → verify sliders activate.
- [ ] Confirm Privacy & Security → Camera permission for the new app.
- [ ] If still disabled, contact NexiGo support for the current installer.
