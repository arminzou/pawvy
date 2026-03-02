# Auto-Generated API Key

Pawvy automatically generates and manages an API key for authentication. This document explains how the mechanism works.

## How Auto-Generation Works

The API key is resolved at server startup using a three-tier fallback strategy:

1. **Environment Variable** — If `PAWVY_API_KEY` is set in the environment, it's used directly.
2. **Existing Key File** — If a key file exists at `~/.pawvy/api-key`, its contents are used.
3. **Generate New Key** — If neither exists, a new 64-character hexadecimal key (256-bit entropy from `crypto.randomBytes(32)`) is generated, saved to the key file, and used.

The key is logged to the console on server startup:

```
🔑 API Key: <your-generated-key>
```

## Where the Key is Stored

The API key is stored in a file at:

```
~/.pawvy/api-key
```

This file is created with restrictive permissions (`0600`) to ensure only the owner can read it.

## How to Use It

### First-Time Setup

On first launch, Pawvy generates a new API key and prints it to the console:

```
🔑 API Key: a1b2c3d4e5f6...
```

Copy this key and use it to log in through the web interface.

### Subsequent Launches

The server reads the existing key from `~/.pawvy/api-key`. The same key persists across restarts unless you delete the file or override it via environment variable.

## Security Considerations

### File Permissions

The key file is created with mode `0600` (read/write for owner only). This prevents other users on the same system from reading your API key.

Verify the permissions:

```bash
ls -la ~/.pawvy/api-key
# -rw------- 1 armin armin 64 ... ~/.pawvy/api-key
```

### Best Practices

- **Never commit the key file** — Add `~/.pawvy/` to your global gitignore or `.gitignore`.
- **Use environment variable in production** — Set `PAWVY_API_KEY` in your deployment environment for better security.
- **Regenerate if compromised** — Delete `~/.pawvy/api-key` and restart the server to generate a new key.

## Overriding with a Custom Key

### Option 1: Environment Variable (Recommended for Production)

Set the `PAWVY_API_KEY` environment variable before starting the server:

```bash
# Docker
docker run -e PAWVY_API_KEY=your-custom-key ...

# systemd service
Environment="PAWVY_API_KEY=your-custom-key"
```

### Option 2: Manual Key File

Replace the contents of `~/.pawvy/api-key` with your custom key:

```bash
echo -n "your-custom-key" > ~/.pawvy/api-key
chmod 600 ~/.pawvy/api-key
```

> **Note:** The key must be a valid string. For security, use a cryptographically random key (e.g., from `openssl rand -hex 32`).

## Summary

| Priority | Source | When Used |
|----------|--------|-----------|
| 1 | `PAWVY_API_KEY` env var | Always (if set) |
| 2 | `~/.pawvy/api-key` file | If env var not set |
| 3 | Generate new key | On first run or if file missing |
