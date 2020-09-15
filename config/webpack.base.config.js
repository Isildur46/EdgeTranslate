"use strict";
const path = require("path");

module.exports = {
    entry: {
        "/background/background": "./src/background/background.js",
        "/content/pdf": "./src/content/pdf.js",
        "/content/select/select": "./src/content/select/select.js",
        "/content/display/display": "./src/content/display/display.js",
        "/popup/popup": "./src/popup/popup.js",
        "/options/options": "./src/options/options.js"
    },
    output: {
        filename: "[name].js",
        path: path.resolve(__dirname, "../build")
    },
    module: {
        rules: [
            {
                test: [/\.html$/, /\.css$/],
                use: "raw-loader"
            }
        ]
    },
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "../src"),
            common: path.resolve(__dirname, "../src/common")
        }
    },
    node: {
        fs: "empty"
    }
};
