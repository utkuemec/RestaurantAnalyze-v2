document.addEventListener('DOMContentLoaded', function() {
    var form = document.getElementById('recommendationForm');
    if (!form) return;

    form.addEventListener('submit', function() {
        var btn = form.querySelector('button[type="submit"]');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Finding recommendations...';
        }
    });
});
