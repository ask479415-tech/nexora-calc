# Nexora Calc

A standalone handwritten-weight calculator built with React, Vite and Capacitor.

## Features
- Capture a page with the phone camera or choose an image from the gallery.
- Gemini Vision reads handwritten Bengali and English weight rows.
- Review, edit, delete and manually add weight rows before calculating.
- Values such as `44,100` mean 44 kg 100 g.
- Automatic total in kilograms and grams.
- Save calculation history on the device.
- Export a PDF bill and share the bill text through WhatsApp.

## AI OCR backend setup (required for photo scanning)
The app uses its own standalone Gemini Vision API service. It does not use or connect to any other app's API or backend. The API key stays on the server and is never included in the APK.

1. Create a Gemini API key at https://aistudio.google.com/app/apikey.
2. Open https://dashboard.render.com/ and choose **New + → Blueprint**.
3. Select the GitHub repository `ask479415-tech/nexora-calc` and deploy the `render.yaml` blueprint.
4. When Render asks for `GEMINI_API_KEY`, paste the key from AI Studio into the Render environment variable field. Do not put the key in source code or send it in chat.
5. Wait until the service is live. The expected service address is `https://nexora-calc-ai.onrender.com`. If Render assigns a different address, update the URL in `src/App.tsx` and build a new APK.
6. Check that opening `https://YOUR-SERVICE.onrender.com/health` returns JSON with `"ok": true`.

The free Render service may sleep when unused; the first scan after inactivity can take longer. Gemini usage is subject to Google's API limits and pricing. Uploaded images are sent to Gemini for recognition and are not saved by this API server.

## Android APK
Every push to `main` starts the GitHub Actions workflow **Build Nexora Calc APK**. Open the repository's **Actions** tab, select the latest completed successful run, and download the `Nexora-Calc-debug-APK` artifact. Extract the ZIP to get `app-debug.apk`.

## Local development
```bash
npm install
npm run dev
```

This project is independent and does not connect to Digital Ojon Khata, Nexora Ride, or any other application or backend.
