# Text Your Commute

A daily SMS survey to determine mode choice.

## Setup

    npm install

## Run Locally

    npm start

## Trigger daily email

Morning at 17:00 UTC
    DEBUG=textyourcommute ./bin/daily-survey --type am

Evening at 2:00 UTC
    DEBUG=textyourcommute ./bin/daily-survey --type pm
