# HPRadar UDP feeder identity

This fork keeps ordinary AIS NMEA output compatible with generic receivers while giving HPRadar a stable feeder identity that survives public-IP changes and supports several receivers behind one NAT.

## Behavior

For UDP NMEA outputs whose destination is `hpradar.com` or a subdomain of `hpradar.com`, AIS-catcher automatically emits a small HPR control datagram from the same UDP socket:

```text
HPR1|550e8400-e29b-41d4-a716-446655440000\r\n
```

The actual AIS output remains ordinary NMEA:

```text
!AIVDM,...\r\n
!AIVDO,...\r\n
```

The UUID is never inserted into an AIS/NMEA sentence. Non-HPR destinations receive no HPR identity datagram.

Transmission policy:

- identity is sent before each of the first three outgoing NMEA datagrams;
- it is then refreshed every 30 seconds;
- a recreated UDP socket repeats the initial burst;
- the HPR server associates the UUID with the observed UDP flow and consumes the identity datagram before NMEA processing.

## Transparent AUTO mode

Default mode is `auto`:

- UDP + NMEA + `hpradar.com` / `*.hpradar.com` => HPR identity enabled;
- any other destination => disabled.

No new command-line option is required for normal HPRadar feeders.

For private infrastructure, tests, or an HPR target configured by raw IP:

```text
HPR_FEEDER_MODE=on
```

To disable the feature explicitly:

```text
HPR_FEEDER_MODE=off
```

Accepted values are `auto` (default), `on/true/1/yes`, and `off/false/0/no`.

## UUID persistence

The client uses the first valid identity available in this order:

1. the existing UDP output `UUID` setting, when explicitly configured;
2. `HPR_FEEDER_UUID` environment variable;
3. `HPR_FEEDER_UUID_FILE`;
4. `/data/hpr-feeder.uuid` on POSIX systems;
5. `$HOME/.aiscatcher-hpr-feeder.uuid` on POSIX or the equivalent local application-data file on Windows;
6. `.hpr-feeder.uuid` in the current working directory.

If no existing UUID is found, AIS-catcher generates a UUIDv4 and writes it to the first writable persistence path. If no path is writable, feeding continues with a UUID that is stable only for the lifetime of that process.

### Production container rule

Persist `/data` or set `HPR_FEEDER_UUID_FILE` to a persistent per-feeder volume/path. Recreating a stateless container without its UUID state intentionally looks like a new feeder to HPRadar and requires a new claim.

### Multiple AIS-catcher processes on one host

Each physical/logical feeder process must have its own UUID state file or volume. Do not let independent receiver instances share the same `/data/hpr-feeder.uuid` or home-directory fallback file. A shared UUID would make HPRadar correctly interpret them as one identity.

## Claiming

The operator does not need to read or copy the UUID.

1. Start AIS-catcher and keep it running.
2. Send UDP NMEA to the HPRadar endpoint normally.
3. In HPRadar feeder management, choose **Claim feeder**.
4. Enter the site's current public IP.
5. If one recent unclaimed UUID is present, HPRadar claims it immediately.
6. If several receivers share that public IP, HPRadar shows short-ID candidates and the operator selects the intended receiver.

After claim, a public-IP change does not require re-claim. The UUID remains the feeder identity; IP is only observed network metadata.

## Security model

The UUID identifies a feeder; it is not a secret and is not an authentication credential. Server-side claim and administrative actions must remain behind the HPRadar admin/authentication boundary. If self-service feeder ownership is later exposed to untrusted Internet users, add a separate secret/challenge mechanism rather than treating UUID as a password.
