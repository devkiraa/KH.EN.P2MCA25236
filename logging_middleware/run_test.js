const { Log } = require('./index');
require('./src/config/env');

(async () => {
  const res = await Log('backend','info','utils','test message from run_test.js');
  console.log('Log call result =>', res);
})();
