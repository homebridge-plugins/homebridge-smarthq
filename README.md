<span align="center">

<a href="https://github.com/homebridge/verified/blob/master/verified-plugins.json"><img alt="homebridge-verified" src="https://raw.githubusercontent.com/homebridge-plugins/homebridge-smarthq/latest/branding/Homebridge_x_Air.svg?sanitize=true" width="350px"></a>

# Homebridge SmartHQ

<a href="https://www.npmjs.com/package/@homebridge-plugins/homebridge-smarthq"><img title="npm version" src="https://badgen.net/npm/v/@homebridge-plugins/homebridge-smarthq?icon=npm&label" ></a>
<a href="https://www.npmjs.com/package/@homebridge-plugins/homebridge-smarthq"><img title="npm downloads" src="https://badgen.net/npm/dt/@homebridge-plugins/homebridge-smarthq?label=downloads" ></a>
<a href="https://discord.gg/8fpZA4S"><img title="discord-air" src="https://badgen.net/discord/online-members/8fpZA4S?icon=discord&label=discord" ></a>
<a href="https://paypal.me/donavanbecker"><img title="donate" src="https://badgen.net/badge/donate/paypal/yellow" ></a>

<p>The Homebridge <a href="https://airnow.gove">SmartHQ</a>
plugin allows you monitor the current AirQuality for your Zip Code from HomeKit and Siri.
</p>

</span>

## Installation

1. Search for "SmartHQ" on the plugin screen of [Homebridge Config UI X](https://github.com/oznu/homebridge-config-ui-x).
2. Click **Install**.

## Configuration

1. Login / create an account at https://airnow.gove/

<p align="center">

<img src="https://user-images.githubusercontent.com/9875439/133934622-05a9c19e-c5ba-46ee-b0db-0748420813d7.png" width="450px">

</p>

2. Type in your SmartHQ.gov API Key and Zip Code
3. Click Save
4. Restart Homebridge

## Supported SmartHQ Quality Providers

Currently supports AQI Services:

- [SmartHQ](https://www.airnow.gov/) which is limited to the USA. A valid ZipCode is required.
- [Aqicn](https://www.aqicn.org/) which has international support, provided by the [World SmartHQ Quality Index Project](http://waqi.info/).

Depending on where exactly you would like to monitor AQI, one service may be more appropriate than the other.

## Supported SmartHQ Quality Features

This plugin will create an DishWasher element. The Home app works well, but the Eve app seems to show more measurements. Measurements retrieved are PM2.5, PM10, & O3 for SmartHQ. Aqicn adds NO2, SO2, CO...

## Thanks

Thank you to [ToddGreenfield](https://github.com/ToddGreenfield) for the the work done on the accesorry based plugin [homebridge-airnow](https://github.com/ToddGreenfield/homebridge-airnow/blob/master/README.md).
