# React Native sensor/UI source scaffold

This folder includes reusable React Native UI, session-only timing telemetry, a merchant proxy client, and a UPI intent/QR generator.

**Not a compiled Android/iOS app yet.** To build, generate compatible native projects using React Native CLI for the version in `package.json`, add these `src/` files, install dependencies, and complete Android/iOS signing and device testing. The native folders intentionally contain instructions instead of pretending to be working native builds.

The app never submits payment screenshots or touch/gyro traces automatically, never treats an intent return as proof of credit, and never embeds n8n/worker credentials. Any API request must go through an authenticated merchant-owned backend, which can expose only scoped session information.

For a local UI preview, configure merchant VPA and amount in the demo screen. For production use, render values from a server-created session only.
