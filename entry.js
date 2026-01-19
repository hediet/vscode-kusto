
if (process.env.KUSTO_HOT_RELOAD === 'true') {
    require('tsx/cjs');
    const { enableHotReload } = require("@hediet/node-reload/node");
    enableHotReload({ entryModule: module, loggingFileRoot: __dirname });

    module.exports.activate = function (context) {
        const { hotReloadExportedItem } = require("@hediet/node-reload");
        context.subscriptions.push(
            hotReloadExportedItem(Extension, (Ext) => {
                extension = new Ext(context);
                return extension;
            })
        );
    };
} else {
    module.exports = require('./dist/entry.js');
}
