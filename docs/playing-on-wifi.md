# Playing with friends on the same wifi

Friends can play on their own phones and laptops while the server runs on your laptop, as
long as everyone is on the same wifi. Their browsers only talk to the website on your
laptop, which passes game traffic on to the server beside it, so the server itself is never
opened to the network. Only the database is online, as usual.

## Steps

**1. Find your laptop's address on the wifi.** In a terminal, run `ipconfig` and look under
"Wireless LAN adapter Wi-Fi" for the "IPv4 Address", e.g. `192.168.1.23`.

**2. Tell the server that address.** In `.env`, set (with your address):

```sh
PUBLIC_URL="http://192.168.1.23:5173"
```

The server only accepts table connections from pages opened at `PUBLIC_URL` (or, outside
production, on your own laptop at `localhost`), so without this your friends can load the
site but not join a table. You can keep using `localhost` yourself.

**3. Start it so the website listens on the wifi.** `pnpm dev` only listens to your own
laptop. Instead, in two terminals:

```sh
pnpm --filter @card-table/server dev
pnpm --filter @card-table/web exec vite --host
```

Vite prints a "Network" address, which should match step 1.

**4. Let it through the Windows firewall.** The first time, Windows may ask whether to allow
Node.js: allow it on **Private** networks. Check the wifi itself is set to Private too
(Settings › Network & Internet › Wi-Fi › your network › Private). On a work laptop, the
firewall may be managed by IT and block incoming connections whatever you choose.

**5. Play.** Friends open `http://192.168.1.23:5173` (your address) and pick a guest name.
Create a table and share its code, or its invite link, which already uses the right address.

## Things to know

- **"Copy link" doesn't work on friends' devices.** Browsers only allow copying from a site on
  `https` or `localhost`. Copy the code or link from the box by hand instead.
- **Some wifi stops devices seeing each other**: guest networks, hotels, some offices. Use a
  normal home network.
- **Your laptop's address can change between days.** If it does, update `PUBLIC_URL` and
  restart.
- **Restarting the server mid-game is safe**: games pick up where they left off. Keep the
  laptop awake while you play.

## Afterwards

To go back to playing on your own, just use `pnpm dev` as usual. You can leave `PUBLIC_URL` in
`.env`: `localhost` works either way. (Sign-in emails link to `PUBLIC_URL`, so if you sign in
by email on your own, remove it or set it back to `http://localhost:5173`.)
