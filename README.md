# Text Your Commute

A daily SMS survey to determine mode choice.

## Overview

This application is a survey that uses SMS to send questions and recieve answers. Users can opt in by texting "start" to the survey phone number, and then answer a few demographic questions. Then, for a specified period of time, they will get daily questions asking about their commute mode.

Responses are stored and after the survey period can provide a csv file showing which modes of transportation survey respondents used.

## Installation

The project is written in node.js and uses mongodb to store data. It relies on the Twilio API for SMS.

    npm install

### Run Locally

    npm start

### Trigger daily survey

Morning at 17:00 UTC
    DEBUG=textyourcommute ./bin/daily-survey --type am

Evening at 2:00 UTC
    DEBUG=textyourcommute ./bin/daily-survey --type pm

## Current Use

This application was used in December, 2016 to survey drivers in Contra Costa County.

## Analysis

Run

     python -m notebook

## License

This project is licensed under GNU General Public License v3.0.
