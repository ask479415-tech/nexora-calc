# Nexora Calc

A standalone handwritten-weight calculator built with React, Vite and Capacitor.

## Features
- English-only interface and English-digit OCR.
- Nexora logo in the app, splash screen and Android launcher icon.
- A two-second in-app splash screen titled **Nexora Digital Calculator**.
- Capture a page with the phone camera or choose an image from the gallery.
- Uses Tesseract.js local OCR with English language data; no paid AI API or backend.
- First use needs an internet connection to download English language data.
- Review, select, edit, delete and manually add weight rows before calculating.
- Values such as `44,100` mean 44 kg 100 g.
- Automatic total in kilograms and grams.
- Save calculation history on the device, export a PDF bill and share bill text through WhatsApp.

## OCR notes
Local OCR is not a generative AI model and cannot guarantee correct recognition of handwriting. Clear, straight, well-lit photos work best. Always review and correct the detected entries before calculating.

## Android APK
Every push to `main` starts **Build Nexora Calc APK**. Open the repository's Actions tab, select the latest successful run, and download the `Nexora-Calc-debug-APK` artifact. Extract the ZIP to get `app-debug.apk`.

## Project independence
This project is independent and does not connect to Digital Ojon Khata, Nexora Ride, or any other application or backend.
