module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'subject-case': [0],        // allow any case in subject
    'body-max-line-length': [0], // no line length limit in body
  },
};
