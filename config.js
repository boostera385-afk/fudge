// Legacy direct writer settings. The normal writer now uses the connected Apps
// Script, with FUDGE_OPENAI_API_KEY stored in its Script properties. Keep apiKey
// empty so the OpenAI key is not exposed in the unpacked extension folder.

const FUDGE_AI = {
  apiKey: "",
  url: "https://api.openai.com/v1/chat/completions",
  model: "gpt-5.6-luna"
};
