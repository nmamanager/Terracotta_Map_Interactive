# Install the exhibit on the four PCs

Follow these steps on each PC. Do the projector PC first, because the touch PCs need its IP address.

## Before you start

You need:

- Four Windows 11 PCs on the same network and subnet. The touch PCs connect to the projector PC on TCP port 8080.
- A fixed IP address for the projector PC. Set a DHCP reservation or a static address.
- Google Chrome on every PC.
- Node.js LTS on the projector PC: `winget install OpenJS.NodeJS.LTS`.
- A local Windows account on each PC for the exhibit to run as, for example `kiosk`. Make it a standard user, not an administrator.
- An administrator account for staff.

## Copy the software

1. Sign in as the kiosk account.
2. Copy this repository to `C:\tcw-map` on every PC. Use `git clone` or copy the folder. A path without spaces avoids quoting problems in the startup scripts.

## Set up the projector PC

1. Connect the projector. Note which display number Windows gives it. Displays are counted from the left starting at 0, in the order **Settings > System > Display** arranges them.
2. Open PowerShell as administrator. Stay signed in as the kiosk account and enter administrator credentials when Windows asks.
3. Run:

	```powershell
	cd C:\tcw-map\kiosk
	.\install.ps1 -Role projector -Monitor 1
	```

	Replace `1` with the projector's display number.

4. Check that the script ends with `All settings read back correctly` and `Registered logon task 'TCW Map Kiosk'`. If it reports a warning, fix that setting before you continue.

The script does four things:

- It writes `kiosk\station.json`.
- It applies the Windows lockdown in `setup_kiosk_os.ps1`.
- It opens TCP port 8080 in Windows Firewall.
- It registers the `TCW Map Kiosk` task, which starts the hub and Chrome 20 seconds after the kiosk account signs in.

## Set up each touch PC

1. Open PowerShell as administrator while signed in as the kiosk account.
2. Run the command for that PC, with the projector PC's IP address:

	```powershell
	cd C:\tcw-map\kiosk
	.\install.ps1 -Role touch -Screen 1 -Hub 192.168.10.50
	```

	| Screen | Where it stands | Places it shows |
	| --- | --- | --- |
	| `1` | North side of the map | Great Pyramid, Pit of Bronze Birds, Tombs of the Concubines, Size of the Mausoleum |
	| `2` | East side | Terracotta Army Pits, Pit of Acrobats, Pit of Stone Armour, Horse Stable Pits |
	| `3` | West side | Workers' graves, Bronze Chariots Pit, Pit of Civil Officials, The First Emperor's Zoo |

3. To change how long a screen waits before it returns to its home page, add `-IdleSeconds 120`. The default is 90.

## Sign the kiosk account in automatically

Windows must sign the kiosk account in by itself after a power cut or a scheduled restart.

1. Download Sysinternals Autologon from Microsoft (`https://learn.microsoft.com/sysinternals/downloads/autologon`).
2. Run it as administrator. Enter the kiosk account and its password, then click **Enable**. Autologon stores the password encrypted, not as plain text in the registry.
3. Restart the PC.

After the restart, the exhibit starts by itself within about 30 seconds.

## Calibrate the projection on the map

Do this once the table, projector, and screens are in their final positions.

1. Connect a keyboard and mouse to the projector PC.
2. Press **Ctrl+Shift+C**. The calibration panel appears over the projection.
3. Drag the four cyan corner handles until the projected base map lines up with the edges of the printed map.
4. Drag each orange **screen** handle to the point where that touch screen meets the map. All of that screen's lines move with it.
5. Press **1**, **2**, or **3** to pick a screen. Then press **Q**, **W**, **E**, or **R** to show each of its four lines. Press **0** to clear.
6. Press **C** and **V** to make the cloud shadows lighter or darker.
7. Press **S** to save. The hub writes the result to `C:\tcw-map\config\layout.json`, and every projector page picks it up at once.
8. Press **Esc** to close the panel. Esc throws away changes you have not saved.

To start again from the WAM positions, press **Shift+R** and then **S**. To move one handle by a single pixel, click it and use the arrow keys. Hold **Shift** to move 10 pixels at a time.

You can also calibrate from a laptop on the same network: open `http://<projector IP>:8080/projector/?calibrate`. The changes apply to the projector as soon as you press **S**.

## Stop the exhibit for maintenance

1. Connect a keyboard.
2. Press **Windows+R**, type `C:\tcw-map\kiosk\stop_kiosk.bat`, and press Enter.

The script stops the watchdog, the kiosk Chrome window, and the hub. Other Chrome windows stay open. To start the exhibit again, run `C:\tcw-map\kiosk\start_kiosk.bat` or restart the PC.

Task Manager is disabled for the kiosk account. To use it, press **Ctrl+Alt+Del**, choose **Sign out**, and sign in with the administrator account.

## Switch a touch screen without a keyboard

Tap the top-left corner of the touch screen five times within three seconds. Enter the staff PIN `2468`. Choose a screen number, or **Map** to show the live projector picture in the corner. The change lasts until the PC restarts. To change the PIN, add `&pin=<digits>` to the touch URL in `kiosk\launch_kiosk.ps1`.

## Undo the lockdown

In an administrator PowerShell, signed in as the kiosk account:

```powershell
C:\tcw-map\kiosk\setup_kiosk_os.ps1 -Role touch -Undo
Unregister-ScheduledTask -TaskName 'TCW Map Kiosk' -Confirm:$false
```

Use `-Role projector` on the projector PC. Restart afterwards.

## Find the logs

| File | Contents |
| --- | --- |
| `C:\tcw-map\logs\kiosk-YYYYMMDD.log` | Watchdog starts, restarts, and the monitor used |
| `C:\tcw-map\logs\hub.log` | Hub connections and every selection change (projector PC only) |
