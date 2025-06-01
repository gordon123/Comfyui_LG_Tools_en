import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

// 获取input目录的文件列表
async function getInputFileList() {
    try {
        const response = await fetch('/object_info');
        const data = await response.json();
        // 从 LoadImage 节点类型获取可用文件列表
        const loadImageInfo = data.LoadImage;
        if (loadImageInfo && loadImageInfo.input && loadImageInfo.input.required && loadImageInfo.input.required.image) {
            return loadImageInfo.input.required.image[0]; // 返回文件列表数组
        }
        return [];
    } catch (error) {
        console.error("获取文件列表失败:", error);
        return [];
    }
}

// 删除图片文件（直接删除，无确认弹窗）
async function deleteImageFile(filename) {
    try {
        const response = await api.fetchApi('/lg/delete_image', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: filename })
        });
        
        if (response.status === 200) {
            const result = await response.json();
            if (result.success) {
                console.log(`文件 ${filename} 删除成功`);
                return true;
            }
        } else {
            const error = await response.json();
            console.error(`删除失败: ${error.error || '未知错误'}`);
            return false;
        }
    } catch (error) {
        console.error(`删除文件失败: ${error}`);
        return false;
    }
}

// 加载最新图片并复制到input文件夹
async function loadLatestImage(node, folder_type) {
    try {
        // 获取指定目录中的最新图片
        const res = await api.fetchApi(`/lg/get/latest_image?type=${folder_type}`);
        
        if (res.status === 200) {
            const item = await res.json();
            
            if (item && item.filename) {
                // 使用后端API直接复制到input文件夹
                const copyRes = await api.fetchApi(`/lg/copy_to_input`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        type: folder_type,
                        filename: item.filename
                    })
                });
                
                if (copyRes.status === 200) {
                    const copyData = await copyRes.json();
                    
                    if (copyData.success) {
                        // 找到图像小部件并更新值
                        const imageWidget = node.widgets.find(w => w.name === 'image');
                        
                        if (imageWidget) {
                            // 获取并更新文件列表
                            const fileList = await getInputFileList();
                            if (fileList.length > 0) {
                                imageWidget.options.values = fileList;
                            }
                            
                            // 更新图像小部件值
                            imageWidget.value = copyData.filename;
                            
                            // 通过回调更新预览图像
                            if (typeof imageWidget.callback === "function") {
                                imageWidget.callback(copyData.filename);
                            }
                            
                            // 更新画布
                            app.graph.setDirtyCanvas(true);
                        }
                    }
                }
            }
        }
    } catch (error) {
        console.error(`加载图像失败: ${error}`);
    }
}

// 扩展ContextMenu以支持图片缩略图和删除功能
function extendContextMenuForThumbnails() {
    const originalContextMenu = LiteGraph.ContextMenu;
    
    LiteGraph.ContextMenu = function(values, options) {
        const ctx = originalContextMenu.call(this, values, options);
        
        // 检查是否是LG_LoadImage节点的image widget的下拉菜单
        if (options?.className === 'dark' && values?.length > 0) {
            // 等待DOM更新后处理
            requestAnimationFrame(() => {
                const currentNode = LGraphCanvas.active_canvas?.current_node;
                
                // 检查是否是LG_LoadImage节点的image widget
                if (currentNode?.comfyClass === "LG_LoadImage") {
                    const imageWidget = currentNode.widgets?.find(w => w.name === 'image');
                    
                    if (imageWidget && imageWidget.options?.values?.length === values.length) {
                        // 限制菜单宽度 - 调整为更宽
                        ctx.root.style.maxWidth = '400px';
                        ctx.root.style.minWidth = '350px';
                        
                        // 为每个菜单项添加缩略图和删除按钮
                        const menuItems = ctx.root.querySelectorAll('.litemenu-entry');
                        
                        menuItems.forEach((item, index) => {
                            if (index < values.length) {
                                const filename = values[index];
                                addThumbnailAndDeleteToMenuItem(item, filename, currentNode, ctx);
                            }
                        });
                    }
                }
            });
        }
        
        return ctx;
    };
    
    // 保持原型链
    LiteGraph.ContextMenu.prototype = originalContextMenu.prototype;
}

// 为菜单项添加缩略图和删除按钮
function addThumbnailAndDeleteToMenuItem(menuItem, filename, node, contextMenu) {
    // 避免重复添加
    if (menuItem.querySelector('.thumbnail-container')) {
        return;
    }
    
    // 保存原始文本内容
    const originalText = menuItem.textContent;
    
    // 清空菜单项内容
    menuItem.innerHTML = '';
    
    // 设置菜单项样式为flex布局
    menuItem.style.cssText += `
        display: flex;
        align-items: center;
        padding: 6px 12px;
        min-height: 48px;
        position: relative;
    `;
    
    // 创建缩略图容器
    const thumbnailContainer = document.createElement('div');
    thumbnailContainer.className = 'thumbnail-container';
    thumbnailContainer.style.cssText = `
        width: 40px;
        height: 40px;
        margin-right: 10px;
        border-radius: 4px;
        overflow: hidden;
        background: #222;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        border: 1px solid #444;
    `;
    
    // 创建缩略图
    const thumbnail = document.createElement('img');
    thumbnail.style.cssText = `
        max-width: 100%;
        max-height: 100%;
        object-fit: cover;
    `;
    
    // 设置图片源
    thumbnail.src = `/view?filename=${encodeURIComponent(filename)}&type=input&subfolder=`;
    thumbnail.alt = filename;
    
    // 处理图片加载失败
    thumbnail.onerror = function() {
        thumbnailContainer.innerHTML = `
            <span style="
                color: #888; 
                font-size: 10px; 
                text-align: center;
                line-height: 1.2;
            ">无<br>预览</span>
        `;
    };
    
    thumbnailContainer.appendChild(thumbnail);
    
    // 创建文件名标签
    const textLabel = document.createElement('span');
    
    // 截断长文件名 - 保留前10位和后10位文件名及扩展名
    let displayName = originalText;
    if (displayName.length > 35) {
        // 保留文件扩展名
        const lastDotIndex = displayName.lastIndexOf('.');
        if (lastDotIndex > 0) {
            const name = displayName.substring(0, lastDotIndex);
            const extension = displayName.substring(lastDotIndex);
            if (name.length > 20) {
                // 保留前10位 + ... + 后10位 + 扩展名
                const firstPart = name.substring(0, 10);
                const lastPart = name.substring(name.length - 10);
                displayName = firstPart + '...' + lastPart + extension;
            }
        } else {
            // 没有扩展名的情况，保留前10位和后10位
            if (displayName.length > 20) {
                const firstPart = displayName.substring(0, 10);
                const lastPart = displayName.substring(displayName.length - 10);
                displayName = firstPart + '...' + lastPart;
            }
        }
    }
    
    textLabel.textContent = displayName;
    textLabel.title = originalText; // 悬停时显示完整文件名
    textLabel.style.cssText = `
        color: inherit;
        font-size: inherit;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
        cursor: pointer;
        max-width: 280px;
        min-width: 0;
    `;
    
    // 创建删除按钮 - 扩大点击范围
    const deleteButton = document.createElement('button');
    deleteButton.innerHTML = '✕';
    deleteButton.title = `删除 ${filename}`;
    deleteButton.style.cssText = `
        width: 28px;
        height: 28px;
        border: none;
        background: transparent;
        color: #888;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        font-weight: bold;
        margin-left: 8px;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0.7;
        transition: all 0.15s;
        padding: 0;
    `;
    
    // 删除按钮悬停效果 - 更明显的反馈
    deleteButton.addEventListener('mouseenter', () => {
        deleteButton.style.opacity = '1';
        deleteButton.style.color = '#fff';
        deleteButton.style.background = 'rgba(255, 255, 255, 0.15)';
        deleteButton.style.transform = 'scale(1.05)';
    });
    
    deleteButton.addEventListener('mouseleave', () => {
        deleteButton.style.opacity = '0.7';
        deleteButton.style.color = '#888';
        deleteButton.style.background = 'transparent';
        deleteButton.style.transform = 'scale(1)';
    });
    
    // 删除按钮点击事件 - 快速删除，无动画延迟
    deleteButton.addEventListener('click', async (e) => {
        e.stopPropagation(); // 阻止触发菜单项选择
        e.preventDefault();
        
        // 立即显示删除中状态
        deleteButton.innerHTML = '⋯';
        deleteButton.style.pointerEvents = 'none';
        deleteButton.style.opacity = '0.5';
        
        // 直接执行删除操作，无确认弹窗
        const deleted = await deleteImageFile(filename);
        
        if (deleted) {
            // 立即移除菜单项，无动画延迟
            if (menuItem.parentNode) {
                menuItem.parentNode.removeChild(menuItem);
            }
            
            // 更新节点的文件列表
            const imageWidget = node.widgets.find(w => w.name === 'image');
            if (imageWidget) {
                // 重新获取文件列表
                const fileList = await getInputFileList();
                imageWidget.options.values = fileList;
                
                // 如果删除的是当前选中的文件，选择第一个可用文件
                if (imageWidget.value === filename) {
                    imageWidget.value = fileList.length > 0 ? fileList[0] : '';
                    
                    // 触发回调更新预览
                    if (typeof imageWidget.callback === "function") {
                        imageWidget.callback(imageWidget.value);
                    }
                }
                
                // 更新画布
                app.graph.setDirtyCanvas(true);
            }
            
            // 检查是否还有剩余菜单项，如果没有则关闭菜单
            const remainingItems = contextMenu.root.querySelectorAll('.litemenu-entry');
            if (remainingItems.length === 0) {
                contextMenu.close();
            }
        } else {
            // 删除失败，恢复按钮状态
            deleteButton.innerHTML = '✕';
            deleteButton.style.pointerEvents = 'auto';
            deleteButton.style.opacity = '0.7';
        }
    });
    
    // 创建可点击区域（除了删除按钮）
    const clickableArea = document.createElement('div');
    clickableArea.style.cssText = `
        display: flex;
        align-items: center;
        flex: 1;
        cursor: pointer;
    `;
    
    clickableArea.appendChild(thumbnailContainer);
    clickableArea.appendChild(textLabel);
    
    // 为可点击区域添加选择事件
    clickableArea.addEventListener('click', () => {
        // 模拟原始菜单项点击
        const imageWidget = node.widgets.find(w => w.name === 'image');
        if (imageWidget) {
            imageWidget.value = filename;
            
            // 触发回调
            if (typeof imageWidget.callback === "function") {
                imageWidget.callback(filename);
            }
            
            // 更新画布
            app.graph.setDirtyCanvas(true);
        }
        
        // 关闭菜单
        contextMenu.close();
    });
    
    // 组装菜单项
    menuItem.appendChild(clickableArea);
    menuItem.appendChild(deleteButton);
    
    // 移除原有的点击事件，因为我们现在有自定义的点击处理
    menuItem.onclick = null;
}

app.registerExtension({
    name: "Comfy.LG.LoadImageButtons",
    
    init() {
        // 扩展ContextMenu以支持缩略图和删除功能
        extendContextMenuForThumbnails();
    },
    
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "LG_LoadImage") return;
        
        const onNodeCreated = nodeType.prototype.onNodeCreated;
        
        nodeType.prototype.onNodeCreated = function() {
            const result = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
            
            const refreshTempButton = this.addWidget("button", "🔄 refresh from Temp", null, () => {
                loadLatestImage(this, "temp");
            });
            refreshTempButton.serialize = false;
            
            const refreshOutputButton = this.addWidget("button", "🔄 refresh from Output", null, () => {
                loadLatestImage(this, "output");
            });
            refreshOutputButton.serialize = false;
            
            return result;
        };
    }
});