# Focus Forge Deployment Guide

This guide turns `focus_forge` into a web app you can open on phone, tablet, or laptop.

## 1. Test On Local Wi-Fi

1. Open a terminal in the project:
   ```bash
   cd C:\Users\vites\Downloads\Desktop\JAAVA\focus_forge
   ```
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Start the app:
   ```bash
   python app.py
   ```
4. Open it on the same laptop:
   [http://127.0.0.1:5050](http://127.0.0.1:5050)
5. Open it on another device on the same Wi-Fi:
   [http://10.39.247.11:5050](http://10.39.247.11:5050)

If it does not open on phone/tablet:
- Keep the laptop awake.
- Make sure phone and laptop are on the same Wi-Fi.
- Allow Python through Windows Firewall.

## 2. Put The Code On GitHub

1. Create a new GitHub repository.
2. Inside the project:
   ```bash
   git init
   git add .
   git commit -m "Prepare Focus Forge for deployment"
   ```
3. Connect to GitHub and push:
   ```bash
   git remote add origin <your-github-repo-url>
   git branch -M main
   git push -u origin main
   ```

## 3. Deploy On Render

1. Sign in to [Render](https://render.com).
2. Click `New` -> `Blueprint`.
3. Select your GitHub repository.
4. Render will detect [render.yaml](/C:/Users/vites/Downloads/Desktop/JAAVA/focus_forge/render.yaml).
5. Approve the service creation.
6. Wait for the build to finish.
7. Open the generated Render URL.

Render notes:
- `SECRET_KEY` is generated automatically.
- SQLite is stored on the attached Render disk at `/var/data/focus_forge.db`.
- HTTPS is automatic.

## 4. Deploy On Railway

1. Sign in to [Railway](https://railway.app).
2. Click `New Project`.
3. Choose `Deploy from GitHub Repo`.
4. Select the Focus Forge repository.
5. Add these environment variables in Railway:
   - `SECRET_KEY` = any strong random value
   - `DATABASE_PATH` = `/data/focus_forge.db`
   - `SESSION_COOKIE_SECURE` = `1`
   - `FLASK_DEBUG` = `0`
6. Railway will use [railway.json](/C:/Users/vites/Downloads/Desktop/JAAVA/focus_forge/railway.json) for the start command.
7. Open the generated Railway URL.

Railway note:
- SQLite on Railway is okay for demo use, but PostgreSQL is better for long-term multi-user use.

## 5. Install On Phone As An App

After deployment on HTTPS:

### Android
1. Open the live URL in Chrome.
2. Tap the browser menu.
3. Tap `Add to Home Screen` or `Install App`.

### iPhone / iPad
1. Open the live URL in Safari.
2. Tap `Share`.
3. Tap `Add to Home Screen`.

## 6. Important Production Notes

- This app currently uses SQLite, which is fine for demos and early use.
- For bigger real-world use, move the database to PostgreSQL.
- Screen share and camera use browser permissions, so mobile browsers may support them differently.
- Full multi-user live video streaming still needs WebRTC or another real-time media layer.

## 7. Best Next Upgrade

If you want the strongest production version next, do this:

1. Move from SQLite to PostgreSQL
2. Add user password reset
3. Add custom domain
4. Add WebRTC for real live video
5. Add admin analytics and leaderboard persistence
