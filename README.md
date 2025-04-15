# Embedded Wallet with Epic Login

Sequence starter with Epic Auth Login [Sequence Embedded Wallet](https://docs.sequence.xyz/solutions/wallets/embedded-wallet/overview) and a cloudflare worker to instantiate the session with Epic and receive a callback.

Need to configure a valid application in epic dev portal.

## Quickstart

Copy `.env.example` to `.env` and fill with your project information. To test things out, you can use the pre-provided keys in the `.env.example` file:

```
cp .env.example .env
```

Then install and run:

```js
pnpm install && pnpm dev
```

The app will start on `localhost:4444`

To provide your own keys from [Sequence Builder](https://sequence.build/), simply edit the `.env` file accordingly.
