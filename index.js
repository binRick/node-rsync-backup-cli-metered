#!/usr/bin/env node

var multimeter = require('multimeter'),
    prettybytes = require('pretty-bytes'),
    Ora = require('ora'),
    bars = [],
    spinners = [],
    c = require('chalk'),
    bytes = require('bytes'),
    multi = multimeter(process),
    syncs = require('./syncs'),
    _ = require('underscore'),
    async = require('async'),
    Rsync = '/usr/local/rsync/bin/rsync --numeric-ids --info=progress2 -ar ',
    child = require('child_process'),
    node = process.argv[2],
    dst = '/tank/rsyncBackups/' + node,
    pj = require('prettyjson'),
    labelMaxLength = 0,
    rs = null;

if (!node || node.length < 1) {
    console.log('First argument is node name');
    process.exit(-1);
}

process.on('exit', function() {
    if (rs.pid) {
        console.log(c.yellow('\nKilling rsync child process with pid ' + c.red.bgWhite(rs.pid)));
        rs.kill();
    }
});


multi.charm.reset();
var spinner1 = new Ora({
    text: 'Listing VMs on ' + node,
    spinner: 'dots12',
});
spinner1.start();
var listCmd = String('ssh -p 31488 ' + node + ' /usr/sbin/vzlist -j1o veid,private').split(' ');
var listChild = child.spawn(listCmd[0], listCmd.slice(1, listCmd.length));
var listString = '';
listChild.stdout.on('data', function(data) {
    listString += data.toString();
});
var oO = {};
listChild.on('exit', function(code) {
    var listJson = JSON.parse(listString.toString());
    labelMaxLength = String(_.max(listJson, function(j) {
        return String(j.veid).length;
    }).veid).length;
    listJson = listJson.map(function(j) {
        var spacesQty = labelMaxLength - String(j.veid).length;
        j.label = j.veid;
        j.spaces = spacesQty;
        var spaces = '';
        while (spacesQty > 0) {
            spacesQty--;
            j.label += ' ';
        }
        j.label = String(j.label);
        return j;
    });
    spinner1.succeed('Found ' + listJson.length + ' VMs on ' + node + '.');
    multi.write('Backing up ' + listJson.length + ' VMs..\n');

    _.each(listJson, function(sync, index) {
        var spaces = ' ';
        var label = sync.label + ':\n';
        multi.write(label);
        var bar = multi(label.length, index + 3, {
            width: 30,
        });
        bars.push(bar);
        bars[index].percent(0);
    });
    multi.write('\n');
    var mapIndex = 0;
    async.mapSeries(listJson, function(sync, _cb) {
            spinners[sync.veid] = new Ora({
                text: 'Backing up CTID ' + sync.veid,
                spinner: 'moon',
            });
            spinners[sync.veid].start();
            var cmd = Rsync + node + ':' + sync.private + ' ' + dst,
                cmdA = cmd.split(' ');
//console.log(cmd);
            rs = child.spawn(cmdA[0], cmdA.slice(1, cmdA.length));
            rs.on('exit', function(code) {
                if (code != 0) {
                    console.log('Command:\n' + cmd + ' exited with code: ' + code);
                    process.exit(-1);

                }
                spinners[sync.veid].succeed(sync.veid + ' :: Copied ' + ' ' + oO.filesTransferred + '/' + oO.totalFiles + ' files ' + '(' + prettybytes(oO.completedBytes) + ')');
                if (code == 0)
                    bars[mapIndex].percent(100);
                mapIndex++;
                _cb(null, {
                    sync: sync,
                    cmd: cmd,
                    result: oO,
                    exitCode: code,
                });
            });
            rs.stdout.on('data', function(data) {
                var o = data.toString().split('\n');
                o = o[o.length - 1].split(')')[0].replace(/\s+/g, ' ').split(' ').filter(function(s) {
                    return s;
                });
if(o.length==0)return;
//console.log(o, o.length);
                    oO.completedBytes= parseInt(o[0].replace(/,/g, '')) || 0;
                    oO.completedPercentage= o[1].replace(/%/, '');
                    oO.speed_bps= parseInt(bytes.parse(o[2].split('B')[0].toLowerCase() + 'b'));
                    oO.elapsedTime= String(o[3]);
                if (o.length == 6){
                    oO.filesTransferred= o[4].split('#')[1].replace(/,/g, '') || 0;
                    oO.scanState= o[5].split('ir').length > 1 ? c.yellow('scanning') : c.green('scanned');
                    oO.filesToCopy= o[5].split('=')[1].split('/')[0];
                    oO.totalFiles= o[5].split('=')[1].split('/')[1];
}
                bars[mapIndex].percent(oO.completedPercentage);
                spinners[sync.veid].text = '[' + oO.scanState + '] ' + 'Synchronized '+prettybytes(oO.completedBytes)+' @' + prettybytes(oO.speed_bps) + '/s';
            });
            rs.stderr.on('data', function(data) {});

        },
        function(errs, syncResults) {
            if (errs) throw errs;
            console.log('Finished');
            console.log(syncResults);
        });
});
