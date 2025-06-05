# CHANGELOG

## [1.1.0] 06-05-2025

### Added

- Aborting the socket now sends a signal to the server that can be loaded with extra payload to also abort server processing.

### Changed

- The socket can not abort on `pause` or `disconnect` anymore.
