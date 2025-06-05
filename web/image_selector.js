import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
app.registerExtension({
    name: "Comfyui_LG_Tools.ImageSelector",
    
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "ImageSelector") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function() {
                const result = onNodeCreated?.apply(this, arguments);
                
                this.selected_images = new Set();
                this.anti_selected = new Set();
                this.currentMode = "always_pause";
                this.isWaitingSelection = false;
                this.isCancelling = false;
                this.imageData = [];
                
                this.isChooser = true;
                this.imageIndex = null;
                
                this.confirmButton = this.addWidget("button", "确认选择", "", () => {
                    this.executeSelection();
                });
                
                this.cancelButton = this.addWidget("button", "取消", "", () => {
                    this.cancelSelection();
                });
                
                this.confirmButton.serialize = false;
                this.cancelButton.serialize = false;
                
                Object.defineProperty(this.confirmButton, "clicked", {
                    get: function() {
                        return this._clicked;
                    },
                    set: function(value) {
                        this._clicked = value && "" != this.name;
                    }
                });
                
                Object.defineProperty(this.cancelButton, "clicked", {
                    get: function() {
                        return this._clicked;
                    },
                    set: function(value) {
                        this._clicked = value && "" != this.name;
                    }
                });
                
                Object.defineProperty(this, "imageIndex", {
                    get: function() {
                        return null;
                    },
                    set: function(value) {
                        // 忽略任何设置imageIndex的尝试
                    }
                });
                
                this.ensurePropertiesValid();
                this.updateWidgets();
                
                return result;
            };

            nodeType.prototype.ensurePropertiesValid = function() {
                if (!(this.selected_images instanceof Set)) {
                    this.selected_images = new Set();
                }
                
                if (!(this.anti_selected instanceof Set)) {
                    this.anti_selected = new Set();
                }
            };

            const onDrawBackground = nodeType.prototype.onDrawBackground;
            nodeType.prototype.onDrawBackground = function(ctx) {
                this.ensurePropertiesValid();
                
                this.pointerDown = null;
                this.overIndex = null;
                
                const result = onDrawBackground?.apply(this, arguments);
                
                this.drawSelectionOverlay(ctx);
                
                return result;
            };
            
            const onMouseDown = nodeType.prototype.onMouseDown;
            nodeType.prototype.onMouseDown = function(event, localPos, graphCanvas) {
                this.ensurePropertiesValid();
                
                if (event.isPrimary && this.imgs && this.imgs.length > 0) {
                    const imageIndex = this.getImageIndexFromClick(localPos);
                    if (imageIndex >= 0) {
                        event.preventDefault();
                        event.stopPropagation();
                        
                        this.pointerDown = null;
                        this.overIndex = null;
                        
                        this.toggleImageSelection(imageIndex);
                        
                        this.setDirtyCanvas(true, true);
                        
                        return true;
                    }
                }
                
                return onMouseDown?.apply(this, arguments);
            };
            
            const onMouseMove = nodeType.prototype.onMouseMove;
            nodeType.prototype.onMouseMove = function(event, localPos, graphCanvas) {
                if (this.isChooser) {
                    this.overIndex = null;
                    this.pointerDown = null;
                }
                
                return onMouseMove?.apply(this, arguments);
            };
            
            const onMouseUp = nodeType.prototype.onMouseUp;
            nodeType.prototype.onMouseUp = function(event, localPos, graphCanvas) {
                if (this.isChooser) {
                    this.pointerDown = null;
                    this.overIndex = null;
                }
                
                return onMouseUp?.apply(this, arguments);
            };

            const originalUpdate = nodeType.prototype.update;
            nodeType.prototype.update = function() {
                this.ensurePropertiesValid();
                
                this.updateWidgets();
                this.setDirtyCanvas(true, true);
                
                if (originalUpdate && originalUpdate !== this.update) {
                    originalUpdate.apply(this, arguments);
                }
            };

            nodeType.prototype.drawSelectionOverlay = function(ctx) {
                if (!this.imageRects || this.imageRects.length === 0 || !this.imgs) return;
                
                this.ensurePropertiesValid();
                
                this.selected_images.forEach(index => {
                    if (index < this.imageRects.length && index < this.imgs.length) {
                        const [x, y, width, height] = this.imageRects[index];
                        
                        ctx.strokeStyle = this.isWaitingSelection ? '#00ff00' : '#4CAF50';
                        ctx.lineWidth = 3;
                        ctx.strokeRect(x + 1, y + 1, width - 2, height - 2);
                        
                        const checkSize = 20;
                        const checkX = x + width - checkSize - 5;
                        const checkY = y + 5;
                        
                        ctx.fillStyle = this.isWaitingSelection ? '#00ff00' : '#4CAF50';
                        ctx.beginPath();
                        ctx.arc(checkX + checkSize/2, checkY + checkSize/2, checkSize/2, 0, 2 * Math.PI);
                        ctx.fill();
                        
                        ctx.strokeStyle = '#ffffff';
                        ctx.lineWidth = 2;
                        ctx.beginPath();
                        ctx.moveTo(checkX + 6, checkY + checkSize/2);
                        ctx.lineTo(checkX + checkSize/2, checkY + checkSize - 6);
                        ctx.lineTo(checkX + checkSize - 4, checkY + 6);
                        ctx.stroke();
                        
                        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
                        ctx.fillRect(x + 2, y + 2, 25, 18);
                        ctx.fillStyle = '#ffffff';
                        ctx.font = '12px Arial';
                        ctx.textAlign = 'center';
                        ctx.fillText((index + 1).toString(), x + 14, y + 15);
                    }
                });
            };
            
            nodeType.prototype.getImageIndexFromClick = function(pos) {
                if (!this.imageRects) return -1;
                
                for (let i = 0; i < this.imageRects.length; i++) {
                    const [x, y, width, height] = this.imageRects[i];
                    if (pos[0] >= x && pos[0] <= x + width &&
                        pos[1] >= y && pos[1] <= y + height) {
                        return i;
                    }
                }
                return -1;
            };
            
            nodeType.prototype.toggleImageSelection = function(index) {
                this.ensurePropertiesValid();
                
                if (this.selected_images.has(index)) {
                    this.selected_images.delete(index);
                } else {
                    this.selected_images.add(index);
                }
                
                this.update();
            };
            
            nodeType.prototype.executeSelection = function() {
                if (!this.isWaitingSelection) {
                    return;
                }
                
                this.ensurePropertiesValid();
                
                const selectedIndices = Array.from(this.selected_images);
                
                fetch('/image_selector/select', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        node_id: this.id.toString(),
                        action: 'select',
                        selected_indices: selectedIndices
                    })
                }).then(response => response.json())
                .then(data => {
                    if (!data.success) {
                        console.error(`选择请求失败:`, data.error);
                    }
                }).catch(error => {
                    console.error(`选择请求异常:`, error);
                });

                this.isWaitingSelection = false;
                this.update();
            };
            
            nodeType.prototype.cancelSelection = function() {
                if (!this.isWaitingSelection) {
                    return;
                }
                
                this.isCancelling = true;
                this.update();
                
                fetch('/image_selector/select', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        node_id: this.id.toString(),
                        action: 'cancel',
                        selected_indices: []
                    })
                }).then(response => response.json())
                .then(data => {
                    if (!data.success) {
                        console.error(`取消请求失败:`, data.error);
                    }
                }).catch(error => {
                    console.error(`取消请求异常:`, error);
                }).finally(() => {
                    this.isCancelling = false;
                    this.update();
                });
            };
            
            nodeType.prototype.updateWidgets = function() {
                if (!this.confirmButton || !this.cancelButton) return;
                
                this.ensurePropertiesValid();
                
                const selectedCount = this.selected_images.size;
                const totalCount = this.imgs ? this.imgs.length : 0;
                
                if (this.isCancelling) {
                    this.confirmButton.name = "正在取消...";
                    this.cancelButton.name = "";
                    this.confirmButton.disabled = true;
                    this.cancelButton.disabled = true;
                } else if (this.isWaitingSelection) {
                    if (selectedCount > 0) {
                        this.confirmButton.name = selectedCount > 1 ? 
                            `确认选择 (${selectedCount}/${totalCount})` : 
                            "确认选择";
                        this.confirmButton.disabled = false;
                    } else {
                        this.confirmButton.name = "请选择图像";
                        this.confirmButton.disabled = true;
                    }
                    this.cancelButton.name = "取消运行";
                    this.cancelButton.disabled = false;
                } else {
                    const modeText = {
                        "always_pause": "等待选择",
                        "keep_last_selection": "自动使用上次选择",
                        "passthrough": "自动通过"
                    }[this.currentMode] || "未知模式";
                    
                    this.confirmButton.name = modeText;
                    this.cancelButton.name = "";
                    this.confirmButton.disabled = true;
                    this.cancelButton.disabled = true;
                }
            };
        }
    },
    
    setup() {
        api.addEventListener("image_selector_update", (event) => {
            const data = event.detail;
            
            const node = app.graph._nodes_by_id[data.id];
            if (!node) {
                return;
            }
            
            if (!node.isChooser) {
                return;
            }
            
            const imageData = data.urls.map((url, index) => ({
                index: index,
                filename: url.filename,
                subfolder: url.subfolder,
                type: url.type
            }));
            
            const modeWidget = node.widgets.find(w => w.name === "mode");
            const currentMode = modeWidget ? modeWidget.value : "always_pause";
            
            node.currentMode = currentMode;
            node.isWaitingSelection = (currentMode === "always_pause" || currentMode === "keep_last_selection");
            node.isCancelling = false;
            node.imageData = imageData;
            
            node.ensurePropertiesValid();
            node.selected_images.clear();
            node.anti_selected.clear();
            
            node.pointerDown = null;
            node.overIndex = null;
            
            node.imgs = [];
            imageData.forEach((imgData, i) => {
                const img = new Image();
                img.onload = () => {
                    app.graph.setDirtyCanvas(true);
                };
                
                img.src = `/view?filename=${encodeURIComponent(imgData.filename)}&type=${imgData.type}&subfolder=${imgData.subfolder || ''}&${app.getPreviewFormatParam()}`;
                node.imgs.push(img);
            });
            
            if (!node.setSizeForImage) {
                node.setSizeForImage = function() {
                    // 使用系统默认的尺寸计算
                };
            }
            
            node.setSizeForImage();
            node.update();
        });
        
        api.addEventListener("image_selector_selection", (event) => {
            const data = event.detail;
            
            const node = app.graph._nodes_by_id[data.id];
            if (node && node.isChooser) {
                node.isWaitingSelection = false;
                node.isCancelling = false;
                
                if (data.selected_indices && Array.isArray(data.selected_indices)) {
                    node.ensurePropertiesValid();
                    node.selected_images.clear();
                    data.selected_indices.forEach(index => {
                        node.selected_images.add(index);
                    });
                }
                
                node.update();
            }
        });
    }
}); 