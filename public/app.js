document.addEventListener('DOMContentLoaded', function() {

    // ---- Scroll progress bar -----------------------------------------------
    var progressBar = document.querySelector('.scroll-progress');
    if (progressBar) {
        window.addEventListener('scroll', function() {
            var h = document.documentElement;
            var pct = (h.scrollTop / (h.scrollHeight - h.clientHeight)) * 100;
            progressBar.style.width = Math.min(pct, 100) + '%';
        }, { passive: true });
    }

    // ---- Navbar scroll effect -----------------------------------------------
    var navbar = document.querySelector('.navbar');
    if (navbar) {
        window.addEventListener('scroll', function() {
            navbar.classList.toggle('scrolled', window.scrollY > 30);
        }, { passive: true });
    }

    // ---- Scroll reveal animations -------------------------------------------
    var revealEls = document.querySelectorAll('.reveal, .reveal-left, .reveal-right, .reveal-scale');
    if (revealEls.length && 'IntersectionObserver' in window) {
        var observer = new IntersectionObserver(function(entries) {
            entries.forEach(function(entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
        revealEls.forEach(function(el) { observer.observe(el); });
    }

    // ---- Like buttons (card + table) ---------------------------------------
    document.querySelectorAll('.like-btn, .like-btn-sm').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var itemName = this.getAttribute('data-item');
            var el = this;

            fetch('/api/like', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ item_name: itemName }),
            })
            .then(function(r) { return r.json(); })
            .then(function() {
                el.innerHTML = '&#9829;';
                el.classList.add('liked');
                showToast('You liked "' + itemName + '"!');
            })
            .catch(function() {
                showToast('Could not save like', true);
            });
        });
    });

    // ---- Similar items toggle ----------------------------------------------
    document.querySelectorAll('.similar-toggle').forEach(function(toggle) {
        toggle.addEventListener('click', function() {
            var itemName = this.getAttribute('data-item');
            var safeId = 'similar-' + itemName.replace(/[^a-zA-Z0-9]/g, '_');
            var container = document.getElementById(safeId);
            if (!container) return;

            if (container.style.display !== 'none') {
                container.style.display = 'none';
                this.innerHTML = 'Show similar &#9662;';
                return;
            }

            if (container.innerHTML.trim()) {
                container.style.display = 'block';
                this.innerHTML = 'Hide similar &#9652;';
                return;
            }

            container.innerHTML = '<div class="loading-text">Finding similar items...</div>';
            container.style.display = 'block';
            this.innerHTML = 'Hide similar &#9652;';

            fetch('/api/similar?item=' + encodeURIComponent(itemName))
            .then(function(r) { return r.json(); })
            .then(function(items) {
                if (!items || items.length === 0) {
                    container.innerHTML = '<div class="loading-text">No similar items found</div>';
                    return;
                }
                var html = '<div class="similar-list">';
                items.forEach(function(item) {
                    html += '<div class="similar-item">';
                    html += '<span class="similar-name">' + item.name + '</span>';
                    html += '<span class="similar-price">$' + item.price.toFixed(2) + '</span>';
                    html += '</div>';
                });
                html += '</div>';
                container.innerHTML = html;
            })
            .catch(function() {
                container.innerHTML = '<div class="loading-text">Error loading similar items</div>';
            });
        });
    });

    // ---- Submit loading state -----------------------------------------------
    var form = document.getElementById('recommendationForm');
    if (form) {
        form.addEventListener('submit', function(e) {
            var food = (document.getElementById('food') || {}).value || '';
            var drink = (document.getElementById('drink') || {}).value || '';
            if (!food.trim() && !drink.trim()) return;
            var btn = form.querySelector('button[type="submit"]');
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<span class="btn-spinner"></span> Finding recommendations...';
            }
        });
    }
});

// ---- Toast notification ----------------------------------------------------
function showToast(msg, isError) {
    var toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.className = 'toast';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.className = 'toast show' + (isError ? ' toast-error' : '');
    setTimeout(function() { toast.className = 'toast'; }, 2500);
}
