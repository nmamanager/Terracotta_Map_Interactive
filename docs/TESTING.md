# Test the exhibit

## Test all four apps on one PC

1. Install Node.js LTS: `winget install OpenJS.NodeJS.LTS`.
2. Double-click `start_test.bat`.

A browser opens `http://localhost:8080/dev/`, which shows four panes: the projector and touch screens 1, 2, and 3. They talk to the real hub, exactly as on site. Click a card in any touch pane, and the projector pane draws that screen's line. Close the black command window to stop the hub.

The header of the test page links to the projector in calibration mode.

## Test on a single touch screen

1. Double-click `start_touch_test.bat`. To start on another screen, run `start_touch_test.bat 2` from a command prompt.
2. The touch app opens full screen. The live projector output shows in the bottom-right corner, so you can see each line draw as you touch.
3. To switch between screens 1, 2, and 3, tap the top-left corner five times and enter PIN `2468`.
4. Press **Alt+F4** to close the touch app, then close the command window to stop the hub.

`start_touch_test.bat` does not lock Windows down. Use it to test content and touch behaviour, not the kiosk lockdown.

## Run the automated checks

```
npm install
npm test
npm run verify
```

- `npm test` runs the hub's state rules in `server/state.test.mjs`.
- `npm run verify` runs `tools/verify.mjs`. It starts a hub and opens the projector and all three touch screens in headless Chrome or Edge. It taps every card, the gallery, the lightbox, and the staff menu with touch events. For each step it checks what the hub records and what the projector draws. It also tests three lines at once, idle reset, saving a calibration, a hub restart, and a touch PC dropping off the network. The run takes about two minutes and ends with `All checks VERIFIED`. Screenshots of every state go to `artifacts/`.
- `node tools/import-assets.mjs --check` confirms that `app/shared/content.js` matches WAM's source files and that the text still equals WAM's `Text.txt` files.

Run all three after any change to the apps, the hub, or the content.

## Check the lockdown on site

Only the real touch hardware can prove the lockdown. Run through this list on each touch PC after `install.ps1` and a restart. Every item must pass.

1. The exhibit starts within about 30 seconds of power-on, with no sign-in prompt and no visible desktop.
2. Swipe in from the left, right, top, and bottom edges. Nothing opens.
3. Swipe with three fingers and with four fingers, in every direction. Nothing changes.
4. Pinch and spread on a card, on an image, and in the lightbox. Nothing zooms.
5. Hold a finger still on a card, on an image, and on empty space for five seconds. No menu, no X, and no exit from full screen.
6. Tap quickly and repeatedly around the screen. No text or image gets selected or highlighted.
7. No touch keyboard appears at any time.
8. Leave the screen on a place for 90 seconds. It returns to its home page, and its line disappears from the map.
9. Unplug the touch PC's network cable while a line shows. The line disappears within about 5 seconds. Plug the cable back in. The screen reconnects within 5 seconds, and the next touch draws a line.
10. Restart the projector PC while a line shows. When the projector PC is back up, the line returns.
11. In Chrome on the kiosk account, **Ctrl+Shift+I** and **F12** do nothing (developer tools are disabled by policy).
12. Leave the PC running overnight. The next morning the screen is still on, with no sleep, screensaver, update restart, or notification.

If item 2 or 3 fails, sign in as the kiosk account and check the values that `setup_kiosk_os.ps1` printed. They must read back as set. The three- and four-finger switch is `HKCU\Control Panel\Desktop\TouchGestureSetting = 0`, and it needs a sign-out to take effect.
