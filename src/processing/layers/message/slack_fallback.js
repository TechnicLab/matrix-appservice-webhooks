module.exports = (webhook, matrix) => {
    if (!webhook.attachments) return;
    var text = "";

    for (var attachment of webhook.attachments) {
        if (!attachment.fallback) return; // Technically required, but we shouldn't break on not having it
        text += attachment.fallback + "\n";
    }

    matrix.event.body = text.trim();
};
