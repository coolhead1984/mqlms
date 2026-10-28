# La Casa Quote Studio

A lightweight, private quotation app for Windows and macOS. It recreates the Silver, Gold and Platinum material cards and floor-by-floor item table in the supplied La Casa quote. Local use needs no account; optional Google Drive sync uses your own Google OAuth client ID.

## Open the app

### Install from a desktop package

- **Windows:** run the `La Casa Quote Studio` `.exe` installer and follow the setup prompts. Open it from the Start menu or desktop shortcut.
- **macOS:** open the `.dmg` and drag Quote Studio into Applications. The package supports both Apple silicon and Intel Macs.

The installed app includes its own runtime; a separate browser or app installation is not needed. Quotations are stored locally on that computer. The app works offline; Google Drive sync requires an internet connection and your Google OAuth client ID.

The original browser-based Windows launcher remains available: double-click **Launch Quote Studio.bat** to start the local server and open Quote Studio in Edge or Chrome.

### Download installers from GitHub

GitHub Actions builds Windows and macOS installer packages when code is pushed to `main`. Open the repository's **Actions** tab, choose the latest successful **Build desktop installers** run, and download the Windows or macOS artifact. To publish permanent download links in a GitHub Release, create and push a version tag such as `v1.0.2`.

The packages are currently unsigned. Windows may show a SmartScreen warning, and macOS may require approval in Privacy & Security before opening. Avoid downloading packages from untrusted sources. Platform signing/notarization can be added when organization-owned signing certificates are available; store signing credentials only as GitHub Actions secrets, never in the repository.

## Move to another computer

On the old computer, use **Download backup** in Settings. Install Quote Studio on the new computer, then use **Restore backup** to import the JSON file. Alternatively, configure Google Drive sync on each installation to merge quotation history. Local browser/app data is not automatically copied by the installer.

The original browser-based Windows profile is separate from the installed desktop app. Before switching, export a backup from the original app and restore it in the installed app if you want to carry over its quotations and settings.

## Create and print a quotation

1. Choose **New quotation** and enter the client's name and project details.
2. Choose a finish to highlight in the quotation. The PDF includes comparable line amounts and a complete total for every finish.
3. Add a library line item or a custom item. Use **Add floor heading** for labels such as Ground Floor and First Floor. Use the up and down arrows to set the order they will appear in the quote.
4. Adjust the quote-specific terms, discount or tax, then choose **Print / Save PDF**. In the print dialog, select **Save as PDF**. The A4 layout includes the supplied La Casa logo, client details, every package's item amounts and total, terms, and acceptance lines.

Silver, Gold and Platinum prices are independent. Selecting a library item fills its prices into the quote. Edit any finish's price in the quote and the library default updates automatically. The sample quotation's Silver rates are included as a starting point; Gold and Platinum rates are deliberately set to zero until you enter the amounts you have agreed to charge. Before printing, confirm every price, quantity, tax and project term. The included wording is a customizable starting template, not legal or tax advice.

## Manage and back up your work

- **Line item library:** add or edit item names, descriptions, units, and rates for each package. Newly named quote items are saved to the library; prices you edit become defaults for future quotations.
- **Settings:** edit your studio's details, rename packages, adjust their material descriptions, set default tax and quote validity, or edit the default terms for new quotations.
- **Quotations:** reopen, copy, search or delete saved quotes.
- **Google Drive:** configure a Google OAuth Web Client ID in Settings, then choose **Connect Google Drive & sync** to merge and retrieve your quotation history. Change accounts whenever needed. Upload PDFs you have exported from the print dialog; the JSON history backup is stored in a **La Casa Quote Studio** folder. Share that folder in Google Drive if other people should have access.
- **Download backup / Restore backup:** transfer your settings, item library and quotations between browsers or computers using a local JSON file.

### Configure Google Drive

Google Drive is optional. To enable it:

1. In Google Cloud Console, create or select a project and enable the **Google Drive API**.
2. Configure the OAuth consent screen. While the app is in Testing, add the Google account you will use as a test user.
3. Create an **OAuth client ID** with application type **Web application**. Add `http://127.0.0.1:49583` as an authorized JavaScript origin. No redirect URI is needed. The installed desktop app uses this same local origin.
4. Copy the client ID (ending in `.apps.googleusercontent.com`) into **Settings → Google Drive** in Quote Studio.
5. Connect and sync while online. Quote history is read from and merged into the Drive JSON backup; PDFs are uploaded when you choose them. Use **Change Google account** to choose another Google login.

The client ID is public configuration, not a password. Never enter a Google password or client secret in Quote Studio. Google Drive uploads are private to the signed-in account until you share the Drive folder with others. Disconnecting or changing accounts does not delete the files already in Drive.

Quotes and settings are saved in Quote Studio's local app profile on this computer. The legacy browser launcher uses its own browser profile. Google Drive sync requires an internet connection and a configured OAuth client ID; download a local backup before removing an app or browser profile.
