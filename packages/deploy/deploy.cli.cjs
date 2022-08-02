#!/usr/bin/env node

let dotenv
try { dotenv = require('dotenv') } catch (e) {}
if (dotenv) dotenv.config()

let ganesha
try { ganesha = require.resolve('@hackbg/ganesha') } catch (e) {
  console.error(e)
  console.error('Could not find @hackbg/ganesha. CLI not available ;d')
  process.exit(1)
}

let deploy
try { deploy = require('path').dirname(require.resolve('@fadroma/deploy')) } catch (e) {
  console.error(e)
  console.error('Could not find @fadroma/deploy. CLI not available ;d')
  process.exit(1)
}

require('@hackbg/ganesha').main([process.argv[0], ganesha, deploy, ...process.argv.slice(2)])
