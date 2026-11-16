# SpeakCoach — Mobile UI Preview

Use the Vite development server and Chrome's Device Toolbar for visual design work. APK installation is not needed for ordinary HTML/CSS layout iterations.

## 1. Start the development server

From the project folder in Codespaces:

```bash
npm install
npm run dev -- --host 0.0.0.0
```

Keep the terminal running. In the Codespaces **Ports** panel, open forwarded port **5173** in the browser. Vite must listen on `0.0.0.0` so the forwarded port can reach it.

## 2. Emulate a portrait phone in Chrome

1. Open Chrome DevTools with `F12`.
2. Toggle the Device Toolbar with `Ctrl+Shift+M`.
3. Select **Responsive** or a phone preset such as Pixel 7.
4. For a consistent baseline, set the viewport to **390 × 844 CSS pixels**, portrait orientation.
5. Make sure the device toolbar is enabled; do not just resize the desktop browser window.
6. Reload once after enabling device emulation.

The app's viewport meta tag is already configured for a mobile-width viewport. Chrome Device Toolbar supplies the phone-sized viewport and device emulation while Vite serves the latest source files.

## 3. Switch between Light and Dark previews

In Chrome DevTools:

1. Open DevTools and press `Ctrl+Shift+P`.
2. Run **Show Rendering**.
3. Under **Emulate CSS media feature prefers-color-scheme**, choose `light` or `dark`.
4. Choose **No emulation** to follow the computer's system setting again.

## 4. Iterate on the design

- Save a CSS or TypeScript file; Vite updates the page automatically.
- Test both Light and Dark themes.
- Check at least one narrow viewport (360 × 800) and the baseline (390 × 844).
- Inspect long text, bottom navigation, keyboard/input behavior, scrolling, and fixed controls.
- Use the browser console and DevTools responsive mode to inspect layout issues.

## 5. When an APK is still needed

Use an APK only for final checks of native Android behavior, such as microphone permissions, audio playback, text-to-speech, file backup/restore, Android navigation, and native plugins. The browser preview is for fast UI/layout iteration; it does not fully emulate Capacitor's native environment.


## 6. If the preview stops working after Codespaces is idle

A stopped Codespace also stops the Vite server. The forwarded preview URL may therefore show an error even though the repository is intact.

1. Open the repository's **Codespaces** page and resume the existing Codespace.
2. In VS Code, open **Terminal → New Terminal**. Do not type the command into an old terminal that is still occupied by Vite.
3. In the new terminal, run:

   ```bash
   npm run dev -- --host 0.0.0.0
   ```

4. Keep that terminal open while previewing the app.
5. Open the **Ports** tab. If port **5173** is missing, forward port 5173. Use the port row's **Open in Browser** action.
6. If the port is already listed, check that its status is **Forwarded** and open it again. If the browser kept an old error page, refresh after the Vite terminal reports that the server is ready.

The preview is not expected to stay online while the Codespace is stopped. No source-code change is needed just to resume it.
