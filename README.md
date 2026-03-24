# AIS-catcher: A multi-platform AIS Receiver

This repository presents the `AIS-catcher` software, a versatile dual-channel AIS receiver that is compatible with a wide range of Software Defined Radios (SDRs). These include RTL-SDR dongles (such as the ShipXplorer AIS dongle and RTL SDR Blog v4), AirSpy (Mini/R2/HF+), HackRF, HydraSDR, SDRPlay, SoapySDR, and file/network input (ZMQ/RTL-TCP/SpyServer). AIS-catcher delivers output in the form of NMEA messages, which can be conveniently displayed on screen or forwarded via UDP/HTTP/TCP. Designed as a lightweight command line utility, AIS-catcher also incorporates a built-in web server for internal use within secure networks. The project home page including several realtime examples can be found at [www.aiscatcher.org](https://www.aiscatcher.org).

<img width="3804" height="1819" alt="image" src="https://github.com/user-attachments/assets/c13b7364-6abe-4df1-a983-ecf4f847f0b3" />

## Purpose

The purpose of `AIS-catcher` is to serve as a platform that encourages the perpetual enhancement of receiver models. We greatly value and appreciate any suggestions, observations, or shared recordings, particularly from setups where the existing models encounter difficulties.

## License

Copyright (C) 2021 - 2026 jvde.github at gmail.com. All rights reserved. Licensed under GNU General Public License v3.0.

## Important Disclaimer
`AIS-catcher` is created for research and educational purposes under the GNU GPL v3 license. It is a hobby project and has not been tested and designed for reliability and correctness. 
You can play with the software but it is the user's responsibility to use it prudently. So, DO NOT rely upon this software in any way including for navigation 
and/or safety of life or property purposes.
There are variations in the legislation concerning radio reception in the different administrations around the world. 
It is your responsibility to determine whether or not your local administration permits the reception and handling of AIS messages from ships. 
It is specifically forbidden to use this software for any illegal purpose whatsoever. 
Only use this software in regions where such use is permitted.

## Feature overview: Input -> Output

![image](https://github.com/user-attachments/assets/6677b833-bd2c-4338-babe-3817d6a7c3ea)

## The aiscatcher.org community

To join, ensure you're on the latest version, visit [www.aiscatcher.org](https://www.aiscatcher.org), and [add](https://www.aiscatcher.org/addstation) your station. Upon registration, you'll receive a personal sharing key. Simply run AIS-catcher on the command line with "-X" followed by your sharing key to share your station's raw AIS data with the community hub. This activates a "Community Feed" in your station's web viewer, accessible under map layers and some other features.


## Links

- Documentation: [here](https://jvde-github.github.io/AIS-catcher-docs/)
- Installation: [here](https://jvde-github.github.io/AIS-catcher-docs/installation/overview)
- What is New? [here](https://jvde-github.github.io/AIS-catcher-docs/what-is-new/)
- Forum: [here](https://github.com/jvde-github/AIS-catcher/discussions)
- Bug Reports: [here](https://github.com/jvde-github/AIS-catcher/issues)

## Web Server

The built-in web server started with `-N` accepts additional `OPTION VALUE` pairs after the port.

Examples:

- `-N 8100 CORS on`
- `-N 8100 CORS off`
- `-N 8100 API_ONLY on CORS on`
- `-N 8100 API_ONLY on CORS on API_STATS on API_SHIPS on API_STREAM on API_DECODE off`

`CORS on` keeps the `Access-Control-Allow-Origin: *` response header. `CORS off` disables that header.
`API_ONLY on` disables the bundled frontend and other static web routes so the built-in web server exposes backend endpoints only. This is useful when hosting a decoupled frontend on Cloudflare Pages or another external origin.

Available endpoint switches:

- `API_FRONTEND` controls `/`, bundled files, `/custom/plugins.js`, `/custom/config.css`, `/about.md`, and `/cdn/*`
- `API_STATS` controls `/api/stat.json` and `/stat.json`
- `API_SHIPS` controls `/api/ships.json`, `/ships.json`, `/api/ships_array.json`, and `/api/ships_full.json`
- `API_PLANES` controls `/api/planes_array.json`
- `API_BINARY` controls `/sb` and `/api/binmsgs.json`
- `API_STREAM` controls `/api/sse`, `/api/signal`, and `/api/log`
- `API_PATHS` controls `/api/path.json`, `/api/allpath.json`, `/api/path.geojson`, and `/api/allpath.geojson`
- `API_DECODE` controls `/api/decode`
- `API_VESSEL` controls `/api/message` and `/api/vessel`
- `API_HISTORY` controls `/api/history_full.json`
- `API_TILES` controls `/tiles/*`
- `API_METRICS` controls `/metrics`
- `API_KML` controls `/kml`
- `API_GEOJSON` controls `/geojson` and `/allpath.geojson`

