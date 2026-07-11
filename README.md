# Amnestic

A Firefox extension that periodically resets a website's cookies & site-data back to a saved starting point, so metered paywalls never hit their limit. Runs on Firefox for desktop and Android.

## What it's for

Some sites give you a handful of free views, and then prompt you to sign-up/pay/etc. If you can clear site-data and the site is usable again, then this addon is for you.

Amnestic allows you to save a snapshot of the site's site-data at a point you pick, and then will restore that snapshot periodically (e.g. every few days, or on each page load, whatever you configure). 

This snapshot should be captured after you've cleared the site-data, and dismissed all the cookie banners & other crap it shoves in your face. Thus when the snapshot is restored each day/session/etc you don't need to click through the crap again. 

## Will it work?

It works when the site counts your views locally - i.e. in cookies or browser storage. That's how many metered paywalls do it. It won't help if the site enforces the limit on its own servers.

Quickest way to find out: Once you hit a paywall, clear the site's data. If the paywall is gone, then this should work for you.

## Privacy

Everything stays on your device. Amnestic makes no network requests and collects nothing. It can only touch a site after you configure it for that specific domain.

## Developing

For developing/testing, you can load it as a temporary add-on:

**Desktop:** open `about:debugging` → **This Firefox** → **Load Temporary Add-on** → pick `manifest.json`.

**Android:** with [`web-ext`](https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext/) and `adb` installed, and USB debugging on:

```sh
web-ext run --target=firefox-android --android-device <android-device-serial-here>
```

## Usage

1. Open the site and click the Amnestic icon.
2. Tap **Enable Amnestic for this site** and accept the permission prompt.
3. Get the site how you want it (you probably wan't to clear it's site-data first), then **Save snapshot**.
4. Tap **Restore snapshot** any time to go back to it, or configure the automatic reset events.

### Automatic resets

You can also let it reset on its own. In the extension settings you can let it reset on these events:

- **Interval:** every N days (6 by default)
- **On page load:** every visit
- **On session start:** first visit after Firefox restarts

These run quietly in the background and don't reload the page.
