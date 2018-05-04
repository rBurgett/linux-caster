const chromecast = require('chromecasts')();
const colors = require('colors/safe');
const express = require('express');
const fs = require('fs-extra-promise');
const input = require('input');
const os = require('os');
const path = require('path');
const uuid = require('uuid');

const port = 3578;

const getPlayers = () => new Promise(resolve => setTimeout(() => {
    resolve(chromecast.players);
}, 3000));

let player;

(async function() {
    try {

        // Create and clear dat folder
        const dataFolder = path.join(__dirname, 'data');
        await fs.emptyDirAsync(dataFolder);

        // Start server
        express()
            .use(express.static(dataFolder))
            .listen(port);

        // Copy file to data folder
        const filePath = process.argv
            .slice(2)
            .join(' ');
        if(!filePath) throw new Error('You must pass in a file path e.g. "/home/user/Movies/some-movie.mp4"');
        const finalFileName = uuid.v4() + path.extname(filePath);
        const finalFilePath = path.join(dataFolder, finalFileName);
        console.log(colors.green('\nCopying file to data folder...'));
        await fs.copyAsync(filePath, finalFilePath);
        console.log(colors.green('File successfully copied.\n'));

        // Find players
        console.log(colors.green('Searching for players...'));
        const players = await getPlayers();
        if(players.length === 0) throw new Error('No players found.');
        console.log('\nPlayers:\n' + colors.yellow(players.map((p, i) => `${i + 1} - ${p.name}`).join('\n')) + '\n');

        // Prompt user to select player
        const numStr = await input.text('Which player would you like to use? (enter number)');
        const num = Number(numStr.replace(/\D/g, ''));
        if(num === 0 || num > players.length) throw new Error('That is not a valid selection!');
        player = players[num - 1];

        // Get file location on local network
        const networkInterfaces = os.networkInterfaces();
        const [ address ] = Object
            .keys(networkInterfaces)
            .filter(key => key !== 'lo')
            .reduce((all, key) => {
                const arr = networkInterfaces[key];
                return [
                    ...all,
                    ...arr.filter(i => i.family === 'IPv4' && i.internal !== true)
                ];
            }, [])
            .map(i => i.address);
        const fileLocation = `http://${address}:${port}/${finalFileName}`;

        console.log('\nControl playback with the following commands:\n> ' + colors.green('play') + '\n> ' + colors.yellow('pause') + '\n> ' + colors.cyan('jump [seconds]') + '\n> ' + colors.red('stop') + '\n');

        const getStatus = () => new Promise(resolve => {
            player.status((err, data) => {
                const { currentItemId, items } = data;
                // const item = items.find(i => i.itemId === currentItemId);
                resolve(data);
            });
        });

        let paused = false;
        let done;
        while(!done) {
            const command = await input.text('>');
            switch(command) {
                case 'play': {
                    if (paused) {
                        player.resume();
                    } else {
                        player.play(fileLocation, {
                            title: path.basename(filePath),
                            type: `video/${path.extname(filePath).slice(1)}`
                        });
                    }
                    break;
                }
                case 'pause': {
                    paused = true;
                    player.pause();
                    break;
                }
                case 'stop': {
                    await new Promise(resolve => {
                        player.stop(() => {
                            resolve();
                        });
                    });
                    done = true;
                    break;
                }
                default: {
                    const jumpPatt = /jump\s+(-*\d+)/;
                    if(jumpPatt.test(command)) {
                        const { currentTime } = await getStatus();
                        const matches = command.match(jumpPatt);
                        const seconds = parseInt(matches[1], 10);
                        const newTime = currentTime + seconds;
                        player.seek(newTime);
                    }
                }
            }
        }

        console.log(colors.green('\nClearing data folder.'));
        await fs.emptyDirSync(dataFolder);
        console.log(colors.green('All done!\n'));
        process.exit();

    } catch(err) {
        if(player) player.stop();
        console.error(err);
        process.exit(1);
    }
})();
