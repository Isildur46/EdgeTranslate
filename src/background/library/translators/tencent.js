import axios from "../axios.js";
import { log } from "../../../common/scripts/common.js";

/**
 * Supported languages.
 */
const LANGUAGES = [
    ["auto", "auto"],
    ["zh-CN", "zh"],
    ["en", "en"],
    ["ja", "jp"],
    ["ko", "kr"],
    ["fr", "fr"],
    ["es", "es"],
    ["it", "it"],
    ["de", "de"],
    ["tr", "tr"],
    ["ru", "ru"],
    ["pt", "pt"],
    ["vi", "vi"],
    ["id", "id"],
    ["th", "th"],
    ["ms", "ms"],
    ["ar", "ar"],
    ["hi", "hi"]
];

class TencentTranslator {
    constructor() {
        /**
         * Max retry times.
         */
        this.MAX_RETRY = 1;

        /**
         * Request tokens
         */
        this.qtk = "";
        this.qtv = "";

        /**
         * Base url.
         */
        this.BASE_URL = "https://fanyi.qq.com";

        /**
         * Request headers.
         */
        this.HEADERS = {
            // Origin: this.BASE_URL
        };

        /**
         * Language to translator language code.
         */
        this.LAN_TO_CODE = new Map(LANGUAGES);

        /**
         * Translator language code to language.
         */
        this.CODE_TO_LAN = new Map(LANGUAGES.map(([lan, code]) => [code, lan]));

        /**
         * TTS audio instance.
         */
        this.AUDIO = new Audio();
    }

    /**
     * Get supported languages of this API.
     *
     * @returns {Set<String>} supported languages
     */
    supportedLanguages() {
        return new Set(this.LAN_TO_CODE.keys());
    }

    /**
     * Request Tencent translate home page in a new tab to update cookies.
     *
     * @returns {Promise<void>} request finished
     */
    async requestHomePage() {
        /**
         * Create a tab to start requesting https://fanyi.qq.com
         */
        let tabId = await new Promise((resolve, reject) =>
            chrome.tabs.create({ url: this.BASE_URL, active: false }, tab => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError.message);
                    return;
                }

                resolve(tab.id);
            })
        );

        /**
         * Check if the tab has been loaded.
         */
        return new Promise((resolve, reject) => {
            let tabUpdateListener = (id, change, tab) => {
                if (id !== tabId || tab.status === "loading") {
                    return;
                }

                // Finished loading, remove the tab.
                chrome.tabs.remove(tabId, () => {
                    if (chrome.runtime.lastError) {
                        log(chrome.runtime.lastError.message);
                    }

                    // Remove added listener.
                    chrome.tabs.onUpdated.removeListener(tabUpdateListener);

                    // It has been loaded, call resolve.
                    if (tab.status === "complete") resolve();
                    // It can not be loaded, call reject.
                    else reject();
                });
            };

            // Add listener.
            chrome.tabs.onUpdated.addListener(tabUpdateListener);
        });
    }

    /**
     * Update request tokens.
     *
     * @returns {Promise<void>} request Promise.
     */
    async updateTokens() {
        // Update cookies first.
        await this.requestHomePage();

        // Get qtk and qrv from cookies.
        return new Promise(resolve => {
            chrome.cookies.getAll({ url: this.BASE_URL }, cookies => {
                for (let cookie of cookies) {
                    if (cookie.name === "qtv") {
                        this.qtv = cookie.value;
                    } else if (cookie.name === "qtk") {
                        this.qtk = cookie.value;
                    }
                }
                resolve();
            });
        });
    }

    /**
     * Parse Google translate result.
     *
     * @param {Object} response Google translate response
     * @param {String} originalText original text
     *
     * @returns {Object} parsed result
     */
    parseResult(response, originalText) {
        let result = {};
        result.originalText = response.translate.records[0].sourceText;
        result.mainMeaning = response.translate.records[0].targetText.split(/\s*\/\s*/g)[0];

        // In case the original text is not returned by the API.
        if (!result.originalText || result.originalText.length <= 0) {
            result.originalText = originalText;
        }

        if (response.suggest && response.suggest.data && response.suggest.data.length > 0) {
            if (response.suggest.data[0].prx_ph_AmE) {
                result.sPronunciation = response.suggest.data[0].prx_ph_AmE;
            }

            if (response.suggest.data[0].examples_json) {
                result.examples = JSON.parse(response.suggest.data[0].examples_json).basic.map(
                    item => {
                        return { source: item.sourceText, target: item.targetText };
                    }
                );
            }
        }

        if (response.dict && response.dict.abstract && response.dict.abstract.length > 0) {
            result.detailedMeanings = response.dict.abstract.map(item => {
                return { pos: item.ps, meaning: item.explanation.join(", ") };
            });
        }

        return result;
    }

    /**
     * Detect language of given text.
     *
     * @param {String} text text to detect
     *
     * @returns {Promise<String>} detected language Promise
     */
    async detect(text) {
        const response = await axios({
            method: "POST",
            baseURL: this.BASE_URL,
            url: "/api/translate",
            headers: this.HEADERS,
            data: new URLSearchParams({
                source: this.LAN_TO_CODE.get("auto"),
                target: this.LAN_TO_CODE.get("zh-CN"),
                sourceText: text
            })
        });

        let result = response.data.translate.source;
        return this.CODE_TO_LAN.get(result);
    }

    /**
     * Translate given text.
     *
     * @param {String} text text to translate
     * @param {String} from source language
     * @param {String} to target language
     *
     * @returns {Promise<Object>} translation Promise
     */
    translate(text, from, to) {
        let retryCount = 0;
        let translateOnce = async () => {
            const response = await axios({
                method: "POST",
                baseURL: this.BASE_URL,
                url: "/api/translate",
                headers: this.HEADERS,
                data: new URLSearchParams({
                    source: this.LAN_TO_CODE.get(from),
                    target: this.LAN_TO_CODE.get(to),
                    sourceText: text,
                    qtv: this.qtv,
                    qtk: this.qtk,
                    sessionUuid: "translate_uuid" + new Date().getTime()
                })
            });

            // Translate succeeded.
            if (response.data.dict || (response.data.translate && retryCount >= this.MAX_RETRY)) {
                let result = this.parseResult(response.data, text);
                return result;
            }

            // Retry.
            if (retryCount < this.MAX_RETRY) {
                retryCount++;
                return this.updateTokens().then(translateOnce);
            }

            throw {
                errorType: "API_ERR",
                errorCode: response.status,
                errorMsg: "Translate failed, please contact developers to report problem.",
                errorObj: response
            };
        };

        return translateOnce();
    }

    /**
     * Pronounce given text.
     *
     * @param {String} text text to pronounce
     * @param {String} language language of text
     * @param {String} speed "fast" or "slow"
     *
     * @returns {Promise<void>} pronounce finished
     */
    // eslint-disable-next-line no-unused-vars
    pronounce(text, language, speed) {
        // Pause audio in case that it's playing.
        this.stopPronounce();

        let retryCount = 0;
        let pronounceOnce = async () => {
            try {
                // Get Tencent guid.
                let guid = await new Promise((resolve, reject) => {
                    chrome.cookies.get({ url: this.BASE_URL, name: "fy_guid" }, cookie => {
                        if (!cookie || !cookie.value) {
                            reject("Tencent guid not found!");
                            return;
                        }
                        resolve(cookie.value);
                    });
                });

                // Construct src url.
                this.AUDIO.src = `${
                    this.BASE_URL
                }/api/tts?platform=PC_Website&lang=${this.LAN_TO_CODE.get(
                    language
                )}&text=${encodeURIComponent(text)}&guid=${guid}`;

                return await this.AUDIO.play();
            } catch (error) {
                // Update cookies on failure.
                if (retryCount < this.MAX_RETRY) {
                    retryCount++;
                    return this.requestHomePage().then(pronounceOnce);
                }

                throw {
                    errorType: "API_ERR",
                    errorCode: 0,
                    errorMsg: "Pronounce failed, please contact developers to report problem.",
                    errorObj: error
                };
            }
        };
        return pronounceOnce();
    }

    /**
     * Pause pronounce.
     */
    stopPronounce() {
        if (!this.AUDIO.paused) {
            this.AUDIO.pause();
        }
    }
}

/**
 * Create and export default translator object.
 */
const TRANSLATOR = new TencentTranslator();
export default TRANSLATOR;
