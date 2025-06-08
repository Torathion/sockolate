# CHANGELOG

## [1.1.1] 06-08-2025

### Fixed

- Missing `payload` argument in `abort` method type declaration

## [1.1.0] 06-05-2025

### Added

- Aborting the socket now sends a signal to the server that can be loaded with extra payload to also abort server processing.

### Changed

- The socket can not abort on `pause` or `disconnect` anymore.
