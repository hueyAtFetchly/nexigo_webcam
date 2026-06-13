# nexicam

Adjust your **NexiGo N680E** webcam's image settings (brightness, contrast, hue,
saturation, sharpness, gamma, backlight, white balance) directly from the
terminal — no App Store app, no grayed-out sliders. Values are written straight
to the camera over USB.

## Start the app

```sh
npm start
```

That opens an interactive menu:

```
1  Set existing profile
2  Edit existing profile
3  Create new profile
4  Delete a profile
5  Reset to default
6  Quit  (or Q)
```

## How to use it

- **Use a profile** — choose `1` and pick it by number; it's applied instantly.
- **Edit a profile** — choose `2` and pick one. Its saved settings load onto the
  live camera, then you adjust them just like creating (see below) and **S** saves
  the changes back to that profile.
- **Create a profile** — choose `3`, give it a name, then pick a setting (`1`–`8`)
  and use **↑ / ↓** to adjust it. The camera changes live as you go.
  Press **Enter** to go back to the setting list, then **S** to save.
  Saving stores the look and resets the camera to default.
- **Delete** — choose `4` and pick a profile to remove.
- **Reset** — choose `5` to return the live camera to default.
- **Quit** — choose `6` or press **Q**.

Profiles are saved in `profiles.json` (ignored by git). Camera settings reset
when the webcam loses power, so just reload your profile after replugging.

## One-off commands (optional)

Without the menu, you can drive the camera directly:

```sh
node nexicam.js list                       # show all settings + current values
node nexicam.js set brightness=+8 contrast=-4
node nexicam.js reset
node nexicam.js load <profile>
```

Values are centered: `0` = balanced (default), `+` brighter/more, `-` the other
way. See `node nexicam.js help` for everything.

## Requirements

macOS + Node. Camera control is done via the bundled `bin/uvc-util`
(from [jtfrey/uvc-util](https://github.com/jtfrey/uvc-util)). The included binary
is `x86_64`; on Apple Silicon rebuild it from source:
`clang -o uvc-util -framework IOKit -framework Foundation *.m`.
