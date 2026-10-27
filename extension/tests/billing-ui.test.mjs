import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

async function renderer(environment) {
  const result = await build({
    stdin: { contents: 'import React from "react"; import {renderToStaticMarkup} from "react-dom/server"; import {PlanSummary} from "./src/ui/shared"; export const render=(account)=>renderToStaticMarkup(React.createElement(PlanSummary,{account,locale:"en"}));', resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, platform: 'node', format: 'cjs', write: false,
    define: { 'import.meta.env': JSON.stringify({ VITE_BILLING_ENVIRONMENT: environment }) },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
  return module.exports.render;
}
const live = await renderer('live');
const testing = await renderer('test');
function account(environment, reason = 'ready', pro = false) {
  return {plan:pro?'pro':'free', billing:{environment,purchasesEnabled:reason==='ready'},billingAvailability:{environment,reason,canPurchase:reason==='ready',canViewPurchases:['ready','disabled'].includes(reason)}};
}
test('Free offers the explicit subscription price and Pro opens management without package balances',()=>{
  const free=live(account('live')); assert.match(free,/Upgrade to Pro/);assert.match(free,/4.99/);assert.match(free,/39.99/);assert.match(free,/100,000 characters/);assert.doesNotMatch(free,/Purchased balance|Buy a package|Images remaining/);
  const pro=live(account('live','ready',true));assert.match(pro,/2,000,000 characters/);assert.match(pro,/Manage subscription/);assert.doesNotMatch(pro,/Upgrade to Pro/);
  assert.match(testing(account('test')),/no real money/);
});
test('subscription purchase gates keep environment and service errors readable',()=>{
 assert.match(live(account('live','environment-mismatch')),/different environments/);
 assert.match(live(account('live','unavailable')),/temporarily unavailable/);
});
