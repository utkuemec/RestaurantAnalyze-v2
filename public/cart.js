(function() {
    'use strict';

    var cart = [];

    try { localStorage.removeItem('mado_cart'); } catch (e) {}

    function save() {
        updateBadge();
        renderCart();
    }

    function totalItems() {
        var n = 0;
        cart.forEach(function(c) { n += c.qty; });
        return n;
    }

    function totalPrice() {
        var t = 0;
        cart.forEach(function(c) { t += c.price * c.qty; });
        return t;
    }

    function findItem(name) {
        for (var i = 0; i < cart.length; i++) {
            if (cart[i].name === name) return i;
        }
        return -1;
    }

    function addItem(name, price, category) {
        var idx = findItem(name);
        if (idx >= 0) {
            cart[idx].qty++;
        } else {
            cart.push({ name: name, price: parseFloat(price), category: category || '', qty: 1 });
        }
        save();
        bumpBadge();
    }

    function removeItem(name) {
        var idx = findItem(name);
        if (idx >= 0) { cart.splice(idx, 1); save(); }
    }

    function setQty(name, qty) {
        var idx = findItem(name);
        if (idx >= 0) {
            if (qty <= 0) { cart.splice(idx, 1); }
            else { cart[idx].qty = qty; }
            save();
        }
    }

    function clearCart() {
        cart = [];
        save();
    }

    // --- Badge ---
    function updateBadge() {
        var badges = document.querySelectorAll('.cart-badge');
        var n = totalItems();
        badges.forEach(function(b) {
            b.textContent = n > 0 ? n : '';
        });
    }

    function bumpBadge() {
        var badges = document.querySelectorAll('.cart-badge');
        badges.forEach(function(b) {
            b.classList.remove('bump');
            void b.offsetWidth;
            b.classList.add('bump');
        });
    }

    // --- Cart Panel DOM ---
    function buildPanel() {
        var overlay = document.createElement('div');
        overlay.id = 'cart-overlay';
        document.body.appendChild(overlay);

        var panel = document.createElement('div');
        panel.id = 'cart-panel';
        panel.innerHTML =
            '<div class="cart-header">' +
                '<h2>&#128722; Your Order</h2>' +
                '<button class="cart-close">&times;</button>' +
            '</div>' +
            '<div class="cart-items" id="cart-items"></div>' +
            '<div class="cart-footer" id="cart-footer"></div>';
        document.body.appendChild(panel);

        overlay.addEventListener('click', closeCart);
        panel.querySelector('.cart-close').addEventListener('click', closeCart);
    }

    function openCart() {
        document.getElementById('cart-panel').classList.add('open');
        document.getElementById('cart-overlay').classList.add('open');
        document.body.style.overflow = 'hidden';
        renderCart();
    }

    function closeCart() {
        document.getElementById('cart-panel').classList.remove('open');
        document.getElementById('cart-overlay').classList.remove('open');
        document.body.style.overflow = '';
    }

    function renderCart() {
        var itemsEl = document.getElementById('cart-items');
        var footerEl = document.getElementById('cart-footer');
        if (!itemsEl || !footerEl) return;

        if (cart.length === 0) {
            itemsEl.innerHTML =
                '<div class="cart-empty">' +
                    '<span class="cart-empty-icon">&#128722;</span>' +
                    'Your cart is empty.<br>Add items from the menu!' +
                '</div>';
            footerEl.style.display = 'none';
            return;
        }

        footerEl.style.display = 'block';
        var html = '';
        cart.forEach(function(item) {
            html +=
                '<div class="cart-item" data-name="' + escHtml(item.name) + '">' +
                    '<div class="cart-item-info">' +
                        '<div class="cart-item-name">' + escHtml(item.name) + '</div>' +
                        '<div class="cart-item-price">$' + item.price.toFixed(2) + ' each</div>' +
                    '</div>' +
                    '<div class="cart-item-controls">' +
                        '<button class="cart-qty-btn" data-action="minus" data-name="' + escHtml(item.name) + '">&minus;</button>' +
                        '<span class="cart-qty">' + item.qty + '</span>' +
                        '<button class="cart-qty-btn" data-action="plus" data-name="' + escHtml(item.name) + '">+</button>' +
                    '</div>' +
                    '<button class="cart-item-remove" data-name="' + escHtml(item.name) + '" title="Remove">&times;</button>' +
                '</div>';
        });
        itemsEl.innerHTML = html;

        footerEl.innerHTML =
            '<div class="cart-total">' +
                '<span class="cart-total-label">Total (' + totalItems() + ' items)</span>' +
                '<span class="cart-total-price">$' + totalPrice().toFixed(2) + '</span>' +
            '</div>' +
            '<p class="cart-hint">Ready to order? Call your server!</p>' +
            '<button class="cart-clear-btn" id="clear-cart-btn">Clear Cart</button>';

        // Quantity buttons
        itemsEl.querySelectorAll('.cart-qty-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var name = this.getAttribute('data-name');
                var idx = findItem(name);
                if (idx < 0) return;
                if (this.getAttribute('data-action') === 'plus') {
                    setQty(name, cart[idx].qty + 1);
                } else {
                    setQty(name, cart[idx].qty - 1);
                }
            });
        });

        // Remove buttons
        itemsEl.querySelectorAll('.cart-item-remove').forEach(function(btn) {
            btn.addEventListener('click', function() {
                removeItem(this.getAttribute('data-name'));
            });
        });

        // Clear cart
        document.getElementById('clear-cart-btn').addEventListener('click', function() {
            if (confirm('Clear all items from your cart?')) clearCart();
        });
    }

    function placeOrder() {
        var btn = document.getElementById('place-order-btn');
        if (!btn || cart.length === 0) return;
        btn.disabled = true;
        btn.textContent = 'Sending order...';

        var orderItems = cart.map(function(c) {
            return { name: c.name, price: c.price, category: c.category, qty: c.qty };
        });

        fetch('/api/order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: orderItems, total: totalPrice() })
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            var orderNum = data.order_number || Math.floor(Math.random() * 9000 + 1000);
            showOrderSuccess(orderNum);
            cart = [];
            save();
        })
        .catch(function() {
            btn.disabled = false;
            btn.textContent = '🍽 Place Order';
            alert('Could not place order. Please try again.');
        });
    }

    function showOrderSuccess(orderNum) {
        var itemsEl = document.getElementById('cart-items');
        var footerEl = document.getElementById('cart-footer');
        if (!itemsEl) return;

        itemsEl.innerHTML =
            '<div class="cart-success">' +
                '<div class="cart-success-icon">&#9989;</div>' +
                '<h3>Order Placed!</h3>' +
                '<p>Order #' + orderNum + '<br>Your server has been notified.<br>Your food will be prepared shortly.</p>' +
            '</div>';
        footerEl.style.display = 'none';

        setTimeout(function() { closeCart(); }, 4000);
    }

    function escHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // --- Add to Cart button handlers ---
    function initAddButtons() {
        document.querySelectorAll('.add-cart-btn, .add-cart-btn-sm').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var name = this.getAttribute('data-item');
                var price = this.getAttribute('data-price');
                var category = this.getAttribute('data-category') || '';
                addItem(name, price, category);

                this.classList.add('added');
                var original = this.innerHTML;
                this.innerHTML = '<span class="cart-icon">&#10003;</span> Added';
                var el = this;
                setTimeout(function() {
                    el.classList.remove('added');
                    el.innerHTML = original;
                }, 1200);
            });
        });
    }

    // --- Navbar cart button handler ---
    function initCartButton() {
        document.querySelectorAll('.navbar-cart').forEach(function(btn) {
            btn.addEventListener('click', openCart);
        });
    }

    // --- Public API for voice concierge ---
    window.madoCart = {
        add: function(name, price, category) { addItem(name, price, category); },
        total: totalPrice,
        count: totalItems,
        open: function() { openCart(); },
    };

    // --- Init ---
    document.addEventListener('DOMContentLoaded', function() {
        buildPanel();
        initAddButtons();
        initCartButton();
        updateBadge();
    });

})();
