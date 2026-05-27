# Physical Board Assets

This directory is for the countertop cooking companion board. The repo is meant
to work as a complete project kit: local server, static recipe UI, and physical
ESP32-S3 voice hardware.

The files here are companion materials for building and flashing the physical
ESP32-S3 device that talks to the server in this repo.

## Contents

- `cooking-companion-sketch/` - Arduino firmware for the ESP32-S3 board.
- `reference/recipe_helper_hardware_reference.pdf` - hardware reference PDF for
  the physical recipe helper prototype.

## Backend Relationship

The board firmware expects this server, or a compatible deployed backend, to
serve the voice API at:

- `POST /query-audio`

Configure the sketch with the deployed backend origin and, when required, the
server API token before flashing it to hardware.
