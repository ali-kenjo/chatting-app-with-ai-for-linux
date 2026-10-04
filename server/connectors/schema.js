// Tool declarations in Gemini's format (openai.js lowers the types for other AIs)
const str = (description) => ({ type: "STRING", description });
const num = (description) => ({ type: "NUMBER", description });
const bool = (description) => ({ type: "BOOLEAN", description });
const oneOf = (values, description) => ({ type: "STRING", enum: values, description });
const fn = (name, description, properties = {}, required = Object.keys(properties)) => ({ name, description, parameters: { type: "OBJECT", properties, required } });

module.exports = { str, num, bool, oneOf, fn };
