# Nexora Calc

A standalone handwritten-weight calculator built with React, Vite and Capacitor.

## Features
- English-only interface and English-digit OCR.
- Nexora logo in the app, splash screen and Android launcher icon.
- A two-second in-app splash screen titled **Nexora Digital Calculator**.
- Capture a page with the phone camera or choose an image from the gallery.
- Fully offline OCR using Tesseract.js with the English language model, worker and WebAssembly runtime bundled into the app build.
- No Gemini, paid AI API, backend, server, or first-run model download.
- Review, select, edit, delete and manually add weight rows before calculating.
- Values such as `44,100` mean 44 kg 100 g.
- Automatic total in kilograms and grams.
- Existing billing workflow is preserved: customer details, rate, amount, bill preview, on-device history, PDF export and WhatsApp sharing.

## Offline operation
The build step copies the English trained data, Tesseract worker and all required WebAssembly core variants into `public/ocr` before Vite builds the app. The OCR engine therefore does not need to download assets at first launch. The app's typography also uses local system fonts rather than a remote font service.

The app's camera, OCR, calculation and bill history are designed to work without internet. Sharing through WhatsApp still depends on WhatsApp being installed and available on the device.

## OCR notes
Local OCR is not a generative AI model and cannot guarantee correct recognition of handwriting. Clear, straight, well-lit photos work best. Always review and correct the detected entries before calculating.

## Android APK
Every push to `main` starts the Android APK build. Open the repository's Actions tab, select the latest successful run, and download the `Nexora-Calc-debug-APK` artifact. Extract the ZIP to get `app-debug.apk`.

## Project independence
This project is independent and does not connect to Digital Ojon Khata, Nexora Ride, or any other application or backend.
