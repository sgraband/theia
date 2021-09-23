/********************************************************************************
 * Copyright (C) 2021 STMicroelectronics and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/
// @ts-check
const { execSync } = require('child_process');
const { copyFile, copyFileSync, readdirSync, writeFileSync, unlinkSync } = require('fs');
const mkdirp = require('mkdirp');
let runs = 10;
let baseTime;
let extensions = [];
let yarn = false;
let url;

async function exitHandler() {
    await cleanWorkspace();
    process.exit();
}

(async () => {
    process.on('SIGINT', exitHandler.bind());
    process.on('exit', exitHandler.bind());
    const args = require('yargs/yargs')(process.argv.slice(2))
        .option('base-time', {
            alias: 'b',
            desc: 'Pass an existing mean of the base application',
            type: 'number'
        })
        .option('runs', {
            alias: 'r',
            desc: 'The amount of runs of the measurement',
            type: 'number'
        })
        .option('extensions', {
            alias: 'e',
            desc: `An array of extensions to test (default are the extensions in the packages folder). Format to escape quotes: '"extension(with quotes)"'`,
            type: 'array'
        })
        .option('yarn', {
            alias: 'y',
            desc: 'Trigger full yarn on script start',
            type: 'boolean'
        }).option('url', {
            alias: 'u',
            desc: 'Specify a custom URL to launch theia (e.g. with a specific workspace)',
            type: 'string'
        }).argv;
    if (args.baseTime) {
        baseTime = parseFloat(args.baseTime.toString()).toFixed(3);
    }
    if (args.extensions) {
        extensions = args.extensions;
    }
    if (args.runs) {
        runs = parseInt(args.runs.toString());
        if (runs < 2) {
            console.error('--runs must be at least 2');
            return;
        }
    }
    if (args.yarn) {
        yarn = true;
    }
    if (args.url) {
        url = args.url;
    }
    prepareWorkspace();
    if (yarn) {
        execSync('yarn build', { cwd: '../../', stdio: 'pipe' });
    } else {
        execSync('yarn browser build', { cwd: '../../', stdio: 'pipe' });
    }
    await extensionImpact(extensions);
})();

async function extensionImpact(extensions) {
    console.log(`Extension Name, Mean (${runs} runs) (in s), Std Dev (in s), CV (%), Delta (in s)`);
    if (baseTime === undefined) {
        calculateExtension(undefined);
    } else {
        console.log(`Base Theia (provided), ${baseTime}, -, -, -`);
    }

    if (extensions.length < 1) {
        extensions = await getPackagesExtensions();
    }

    for (const e of extensions) {
        await calculateExtension(e);
        copyBasePackage();
    }
}

function prepareWorkspace() {
    copyFileSync('../../examples/browser/package.json', './backup-package.json');
    copyBasePackage();
    mkdirp('../../noPlugins', function (err) {
        if (err) {
            console.log(err);
        }
    });
}

async function cleanWorkspace() {
    copyFileSync('./backup-package.json', '../../examples/browser/package.json');
    unlinkSync('./backup-package.json');
}

function copyBasePackage() {
    copyFile('./base-package.json', '../../examples/browser/package.json', (err) => {
        if (err) {
            console.log(err);
        }
    });
}

async function getPackagesExtensions() {
    const directories = readdirSync('../../packages', { withFileTypes: true })
        .filter(dir => dir.isDirectory())
        .map(dir => dir.name)
        .filter(dir => dir !== 'core');

    let qualifiers = [];
    for (const directory of directories) {
        const name = `"${require(`../../packages/${directory}/package.json`).name}"`;
        const version = `"${require(`../../packages/${directory}/package.json`).version}"`;
        qualifiers.push(name + ': ' + version);
    }
    return qualifiers;
}

async function calculateExtension(extensionQualifier) {
    if (extensionQualifier !== undefined) {
        const qualifier = extensionQualifier.replace(/"/g, '');
        const name = qualifier.substring(0, qualifier.lastIndexOf(':'));
        const version = qualifier.substring(qualifier.lastIndexOf(':') + 1);
        const package = require(`../../examples/browser/package.json`);
        package.dependencies[name] = version;
        writeFileSync(`../../examples/browser/package.json`, JSON.stringify(package, null, 2));
        execSync('yarn browser build', { cwd: '../../', stdio: 'pipe' });
    } else {
        extensionQualifier = "Base Theia";
    }
    let output = execSync(
        `concurrently --success first -k -r "cd scripts/performance && node measure-performance.js --name Startup --folder script --runs ${runs}${url ? ' --url ' + url : ''}" `
        + `"yarn --cwd examples/browser start | grep -v '.*'"`, { cwd: '../../' });
    let mean = parseFloat(getMeasurement(output, '[MEAN] Largest Contentful Paint (LCP):'));
    let stdev = parseFloat(getMeasurement(output, '[STDEV] Largest Contentful Paint (LCP):'));

    if (isNaN(mean) || isNaN(stdev)) {
        console.log(`${extensionQualifier}, Error while measuring with this extension, -, -, -`);
    } else {
        let cv = ((stdev / mean) * 100).toFixed(3);
        let diff;
        if (baseTime === undefined) {
            diff = '-';
            baseTime = mean;
        } else {
            diff = (mean - baseTime).toFixed(3);
        }
        console.log(`${extensionQualifier}, ${mean.toFixed(3)}, ${stdev.toFixed(3)}, ${cv}, ${diff}`);
    }
}

function getMeasurement(output, identifier) {
    const firstIndex = output.lastIndexOf(identifier) + identifier.length + 1;
    const lastIndex = output.indexOf("seconds", firstIndex) - 1;
    return output.toString().substring(firstIndex, lastIndex);
}
