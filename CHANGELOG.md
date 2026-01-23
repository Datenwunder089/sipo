# Changelog

All notable changes to this forked Documenso instance will be documented in this file.

## [Unreleased]

### 2026-01-17

#### Infrastructure
- Initial setup of forked Documenso instance on Azure VM (135.225.105.52)
- Configured development environment with Docker containers:
  - PostgreSQL database (port 54320)
  - Mail server (ports 1100, 2500, 9000)
  - MinIO file storage (ports 9001-9002)
- Configured external access by running dev server with `--host 0.0.0.0` flag
- Azure NSG rule added to allow inbound traffic on port 3000

#### Documentation
- Created LEARNING-LOG.md with startup instructions and troubleshooting guide
- Created CHANGELOG.md to track project changes
