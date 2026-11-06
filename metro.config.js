// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);
// the drum kit ships as FLAC (assets/kits/hiphop); Metro doesn't bundle .flac by default
config.resolver.assetExts.push('flac');

module.exports = config;
