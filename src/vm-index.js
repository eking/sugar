/**
 * 简单的数据绑定视图层库
 */
define([
	'./util',
	'./vm-watcher'
], function(util, Watcher) {

	/**
	 * VM构造函数
	 * @param  {DOMElement}  element  [视图的挂载原生DOM]
	 * @param  {Object}      model    [数据模型对象]
	 */
	function VM(element, model) {
		if (!this.isElementNode(element)) {
			util.error('element must be a type of DOMElement: ', element);
			return;
		}

		if (!util.isObject(model)) {
			util.error('model must be a type of Object: ', model);
			return;
		}

		// 缓存根节点
		this.$element = element;
		// 根节点转为文档碎片
		this.$fragment = this.nodeToFragment(element);

		// VM数据模型
		this.$data = model;
		// DOM对象注册索引
		this.$data.$els = {};
		// 事件绑定回调集合
		this.$listeners = {};

		// 未编译指令数目
		this.$unCompileCount = 0;
		// 未编译节点缓存队列
		this.$unCompileNodes = [];
		// 根节点是否已完成编译
		this.$rootComplied = false;

		this.watcher = new Watcher(this.$data);

		// vmodel限制使用的表单元素
		this.$inputs = ['input', 'select', 'textarea'];

		this.init();
	}
	VM.prototype = {
		constructor: VM,

		init: function() {
			var illegal;
			util.each(this.$data, function(value, key) {
				if (key.indexOf('*') !== -1) {
					illegal = true;
					return false;
				}
			});

			if (illegal) {
				util.error('model key cannot contain the character \'*\'!');
			}
			else {
				this.parseElement(this.$fragment, true);
			}
		},

		/**
		 * DOMElement转换成文档片段
		 * @param   {DOMElement}  element
		 */
		nodeToFragment: function(element) {
			var child;
			var fragment = this.createFragment();
			var cloneNode = element.cloneNode(true);

			while (child = cloneNode.firstChild) {
				fragment.appendChild(child);
			}

			return fragment;
		},

		/**
		 * 解析文档碎片/节点
		 * @param   {Fragment|DOMElement}  element   [文档碎片/节点]
		 * @param   {Boolean}              root      [是否是编译根节点]
		 * @param   {Array}                fors      [vfor数据]
		 */
		parseElement: function(element, root, fors) {
			var node, dirCount;
			var childNodes = element.childNodes;

			// 解析所有的子节点
			for (var i = 0; i < childNodes.length; i++) {
				node = childNodes[i];
				dirCount = this.getDirectivesCount(node);
				this.$unCompileCount += dirCount;

				if (dirCount) {
					this.$unCompileNodes.push([node, fors]);
				}

				if (node.childNodes.length && !this.isLateCompileNode(node)) {
					this.parseElement(node, false, fors);
				}
			}

			if (root) {
				this.compileAllNodes();
			}
		},

		/**
		 * 获取节点的指令数
		 * @param   {DOMElement}  node
		 * @return  {Number}
		 */
		getDirectivesCount: function(node) {
			var count = 0, nodeAttrs;
			var regDelimiters = /(\{\{.*\}\})/;
			if (this.isElementNode(node)) {
				nodeAttrs = node.attributes;
				for (var i = 0; i < nodeAttrs.length; i++) {
					if (this.isDirective(nodeAttrs[i].name)) {
						count++;
					}
				}
			}
			else if (this.isTextNode(node) && regDelimiters.test(node.textContent)) {
				count++;
			}
			return count;
		},

		/**
		 * 编译节点缓存队列
		 */
		compileAllNodes: function() {
			util.each(this.$unCompileNodes, function(info) {
				this.collectDirectives(info);
				return null;
			}, this);
		},

		/**
		 * 收集并编译节点指令
		 * @param   {Array}  info   [node, fors]
		 */
		collectDirectives: function(info) {
			var atr, attrs = [], nodeAttrs;
			var node = info[0], fors = info[1];

			if (this.isElementNode(node)) {
				// node节点集合转为数组
				nodeAttrs = node.attributes

				for (var i = 0; i < nodeAttrs.length; i++) {
					atr = nodeAttrs[i];
					if (this.isDirective(atr.name)) {
						attrs.push(atr);
					}
				}

				// 编译节点指令
				util.each(attrs, function(attr) {
					this.compileDirective(node, attr, fors);
				}, this);
			}
			else if (this.isTextNode(node)) {
				this.compileTextNode(node, fors);
			}
		},

		/**
		 * 编译元素节点指令
		 * @param   {DOMElement}      node
		 * @param   {Object}          directive
		 * @param   {Array}           fors       [vfor数据]
		 */
		compileDirective: function(node, directive, fors) {
			var name = directive.name;
			var args = [node, directive.value, name, fors];

			// 移除指令标记
			this.reduceCount().removeAttr(node, name);

			util.defineProperty(node, '_directive', name, false, false, false);

			// 动态指令：v-bind:xxx
			if (name.indexOf('v-bind') === 0) {
				this.handleBind.apply(this, args);
			}
			// 动态指令：v-on:xxx
			else if (name.indexOf('v-on') === 0) {
				this.handleOn.apply(this, args);
			}
			// 静态指令
			else {
				switch (name) {
					case 'v-el':
						this.handleEl.apply(this, args);
						break;
					case 'v-text':
						this.handleText.apply(this, args);
						break;
					case 'v-html':
						this.handleHtml.apply(this, args);
						break;
					case 'v-show':
						this.handleShow.apply(this, args);
						break;
					case 'v-if':
						this.handleIf.apply(this, args);
						break;
					case 'v-model':
						this.handleModel.apply(this, args);
						break;
					case 'v-for':
						this.handleFor.apply(this, args);
						break;
					default: util.warn(name + ' is an unknown directive!');
				}
			}

			if (!fors) {
				this.checkCompleted();
			}
		},

		/**
		 * 编译文本节点
		 * @param   {DOMElement}   node
		 * @param   {Array}        fors     [vfor数据]
		 */
		compileTextNode: function(node, fors) {
			var text = node.textContent;
			var matches = text.match(new RegExp('{{(.+?)}}', 'g'));
			var match = matches[0];
			var splits = text.split(match);
			var field = match.replace(/\{|\{|\}|\}/g, '');

			node._vm_text_prefix = splits[0];
			node._vm_text_suffix = splits[splits.length - 1];

			this.reduceCount().handleText(node, field, 'v-text-plain', fors);

			if (!fors) {
				this.checkCompleted();
			}
		},

		/**
		 * 未编译数减一
		 */
		reduceCount: function() {
			this.$unCompileCount--;
			return this;
		},

		/**
		 * 是否是元素节点
		 * @param   {DOMElement}   element
		 * @return  {Boolean}
		 */
		isElementNode: function(element) {
			return element.nodeType === 1;
		},

		/**
		 * 是否是文本节点
		 * @param   {DOMElement}   element
		 * @return  {Boolean}
		 */
		isTextNode: function(element) {
			return element.nodeType === 3;
		},

		/**
		 * 是否是合法指令
		 * @param   {String}   directive
		 * @return  {Boolean}
		 */
		isDirective: function(directive) {
			return directive.indexOf('v-') === 0;
		},

		/**
		 * 节点的子节点是否延迟编译
		 * vif, vfor的子节点为处理指令时单独编译
		 * @param   {DOMElement}   node
		 * @return  {Boolean}
		 */
		isLateCompileNode: function(node) {
			return this.hasAttr(node, 'v-if') || this.hasAttr(node, 'v-for');
		},

		/**
		 * 检查根节点是否编译完成
		 */
		checkCompleted: function() {
			if (this.$unCompileCount === 0 && !this.$rootComplied) {
				this.rootComplieCompleted();
			}
		},

		/**
		 * 根节点编译完成，更新视图
		 */
		rootComplieCompleted: function() {
			var element = this.$element;
			this.empty(element);
			this.$rootComplied = true;
			element.appendChild(this.$fragment);
		},

		/**
		 * 返回一个空文档碎片
		 * @return  {Fragment}
		 */
		createFragment: function() {
			return util.DOC.createDocumentFragment();
		},

		/**
		 * 清空element的所有子节点
		 * @param   {DOMElement}  element
		 */
		empty: function(element) {
			while (element.firstChild) {
				element.removeChild(element.firstChild);
			}
		},

		/**
		 * 设置节点属性
		 * @param   {DOMElement}  node
		 * @param   {String}      name
		 * @param   {String}      value
		 */
		setAttr: function(node, name, value) {
			node.setAttribute(name, value);
			return this;
		},

		/**
		 * 获取节点属性值
		 * @param   {DOMElement}  node
		 * @param   {String}      name
		 * @return  {String}
		 */
		getAttr: function(node, name) {
			return node.getAttribute(name) || '';
		},

		/**
		 * 判断节点是否存在属性
		 * @param   {DOMElement}  node
		 * @param   {String}      name
		 * @return  {Boolean}
		 */
		hasAttr: function(node, name) {
			return node.hasAttribute(name);
		},

		/**
		 * 移除节点属性
		 * @param   {DOMElement}  node
		 * @param   {String}      name
		 */
		removeAttr: function(node, name) {
			node.removeAttribute(name);
			return this;
		},

		/**
		 * 节点添加classname
		 * @param  {DOMElement}  node
		 * @param  {String}      classname
		 */
		addClass: function(node, classname) {
			var current, list = node.classList;
			if (list) {
				list.add(classname);
			}
			else {
				current = ' ' + this.getAttr(node, 'class') + ' ';
				if (current.indexOf(' ' + classname + ' ') === -1) {
					this.setAttr(node, 'class', (current + classname).trim());
				}
			}
			return this;
		},

		/**
		 * 节点删除classname
		 * @param  {DOMElement}  node
		 * @param  {String}      classname
		 */
		removeClass: function(node, classname) {
			var current, target, list = node.classList;
			if (list) {
				list.remove(classname);
			}
			else {
				target = ' ' + classname + ' ';
				current = ' ' + this.getAttr(node, 'class') + ' ';
				while (current.indexOf(target) !== -1) {
					current = current.replace(target, ' ');
				}
				this.setAttr(node, 'class', current.trim());
			}

			if (!node.className) {
				this.removeAttr(node, 'class');
			}
			return this;
		},

		/**
		 * 去掉字符串中所有空格
		 * @param   {String}  string
		 * @return  {String}
		 */
		removeSpace: function(string) {
			return string.replace(/\s/g, '');
		},

		/**
		 * 字符串HTML转文档碎片
		 * @param   {String}    html
		 * @return  {Fragment}
		 */
		stringToFragment: function(html) {
			var div, fragment;

			// 存在标签
			if (/<[^>]+>/g.test(html)) {
				div = util.DOC.createElement('div');
				div.innerHTML = html;
				fragment = this.nodeToFragment(div);
			}
			// 纯文本节点
			else {
				fragment = this.createFragment();
				fragment.appendChild(util.DOC.createTextNode(html));
			}

			return fragment;
		},

		/**
		 * 设置VM数据值
		 * @param  {String}  field
		 * @param  {Mix}     value
		 */
		setData: function(field, value) {
			this.$data[field] = value;
			return this;
		},

		/**
		 * 获取当前VM数据值
		 * @param  {String}  field
		 * @param  {Mix}     value
		 */
		getData: function(field) {
			return this.$data[field];
		},

		/**
		 * 拆解字符键值对，返回键和值
		 * @param   {String}         expression
		 * @param   {Boolean}        both          [是否返回键和值]
		 * @return  {String|Array}
		 */
		getStringKeyValue: function(expression, both) {
			var array = expression.split(':');
			return both ? array : array.pop();
		},

		/**
		 * 分解字符串函数参数
		 * @param   {String}  expression
		 * @return  {Array}
		 */
		stringToParameters: function(expression) {
			var ret, params, func;
			var matches = expression.match(/(\(.*\))/);
			var result = matches && matches[0];

			// 有函数名和参数
			if (result) {
				params = result.substr(1, result.length - 2).split(',');
				func = expression.substr(0, expression.indexOf(result));
				ret = [func, params];
			}
			// 只有函数名
			else {
				ret = [expression, params];
			}

			return ret;
		},

		/**
		 * 字符JSON结构转为键值数组
		 * @param   {String}  jsonString
		 * @return  {Array}
		 */
		jsonStringToArray: function(jsonString) {
			var ret = [], props, leng = jsonString.length;

			if (jsonString.charAt(0) === '{' && jsonString.charAt(leng - 1) === '}') {
				props = jsonString.substr(1, leng - 2).match(/[^,]+:[^:]+((?=,[\w_-]+:)|$)/g);
				util.each(props, function(prop) {
					var vals = this.getStringKeyValue(prop, true);
					var name = vals[0], value = vals[1];
					if (name && value) {
						ret.push({
							'name' : name,
							'value': value
						});
					}
				}, this);
			}
			return ret;
		},

		/**
		 * 节点事件绑定
		 * @param   {DOMElement}    node
		 * @param   {String}        evt
		 * @param   {Function}      callback
		 */
		addEvent: function(node, evt, callback) {
			node.addEventListener(evt, callback);
			return this;
		},

		/**
		 * 解除节点事件绑定
		 * @param   {DOMElement}    node
		 * @param   {String}        evt
		 * @param   {Function}      callback
		 */
		removeEvent: function(node, evt, callback) {
			node.removeEventListener(evt, callback);
			return this;
		},

		/**
		 * 获取vfor中循环对象的键名
		 * @param   {String}  field
		 * @param   {Object}  item
		 * @return  {String}
		 */
		getVforKey: function(field) {
			var pos = field.lastIndexOf('.');
			return pos === -1 ? '' : field.substr(pos + 1);
		},

		/**
		 * 获取vfor中循环对象的值
		 */
		getVforValue: function(value, fors) {
			var splits = value.split('.');
			var alias = splits[0], key = splits[splits.length - 1];
			var map = fors[3], scope = (map && map[alias]) || fors[0];
			return alias === key ? scope : scope[key];
		},

		/**
		 * 获取vfor中当前循环对象的监测访问路径
		 */
		getVforAccess: function(value, fors) {
			var splits = value.split('.');
			var path = fors[2], level = fors[5], alias = splits[0]
			var key = splits[splits.length - 1], suffix = splits.length === 1 ? '' : '*' + key;
			return alias === fors[4] ? (fors[2] + suffix) : (path.split('*', level).join('*') + suffix);
		},

		/**
		 * 替换vfor循环体表达式中的下标
		 * @param   {String}          expression
		 * @return  {String|Number}   index
		 * @return  {String}
		 */
		replaceVforIndex: function(expression, index) {
			return expression.indexOf('$index') === -1 ? null : expression.replace(/\$index/g, index);
		},

		/********** 指令实现方法 **********/

		/**
		 * v-el（唯一不需要在model中声明的指令）
		 */
		handleEl: function(node, value) {
			this.$data.$els[value] = node;
		},

		/**
		 * v-text DOM文本
		 */
		handleText: function(node, value, name, fors) {
			var access, text, replace;
			var watcher = this.watcher;

			// v-for
			if (fors) {
				replace = this.replaceVforIndex(value, fors[1]);
				if (replace) {
					text = replace;
				}
				else {
					text = this.getVforValue(value, fors);
					access = this.getVforAccess(value, fors);
					// 监测访问路径
					watcher.watchAccess(access, function(last) {
						this.updateNodeTextContent(node, last);
					}, this);
				}
			}
			else {
				text = this.getData(value);
				watcher.add(value, function(path, last) {
					this.updateNodeTextContent(node, last);
				}, this);
			}

			this.updateNodeTextContent(node, text);
		},

		/**
		 * v-html DOM布局
		 */
		handleHtml: function(node, value) {
			var init = this.getData(value);
			this.updateNodeHtmlContent(node, init);

			this.watcher.add(value, function(path, last) {
				this.updateNodeHtmlContent(node, last);
			}, this);
		},

		/**
		 * v-show 控制节点的显示隐藏
		 */
		handleShow: function(node, value) {
			var init = this.getData(value);
			this.updateNodeDisplay(node, init);

			this.watcher.add(value, function(path, last) {
				this.updateNodeDisplay(node, last);
			}, this);
		},

		/**
		 * v-if 控制节点内容的渲染
		 */
		handleIf: function(node, value) {
			var init = this.getData(value);
			this.updateNodeRenderContent(node, init, true);

			this.watcher.add(value, function(path, last) {
				this.updateNodeRenderContent(node, last, false);
			}, this);
		},

		/**
		 * v-bind 动态绑定一个或多个attribute
		 * 除class外，一个attribute只能有一个value
		 */
		handleBind: function(node, value, attr, fors) {
			var directive = this.removeSpace(attr);
			var expression = this.removeSpace(value);
			var val, props = this.jsonStringToArray(expression);

			// 单个attribute v-bind:class="xxx"
			if (directive.indexOf(':') !== -1) {
				val = this.getStringKeyValue(directive);

				// class
				if (val === 'class') {
					// 多个class的json结构
					if (props.length) {
						util.each(props, function(prop) {
							this.bindClassName(node, prop.value, prop.name, fors);
						}, this);
					}
					// 单个class，classname由expression的值决定
					else {
						this.bindClassName(node, expression, null, fors);
					}
				}
				// 行内样式
				else if (val === 'style') {
					// 多个inline-style的json结构
					if (props.length) {
						util.each(props, function(prop) {
							this.bindInlineStyle(node, prop.value, prop.name, fors);
						}, this);
					}
					// 单个inline-style
					else {
						this.bindInlineStyle(node, expression, null, fors);
					}
				}
				// 其他属性
				else {
					this.bindNormalAttribute(node, expression, val);
				}
			}
			// 多个attributes "v-bind={id:xxxx, name: yyy, data-id: zzz}"
			else {
				util.each(props, function(prop) {
					var name = prop.name;
					var value = prop.value;
					if (name === 'class') {
						this.bindClassName(node, value, null, fors);
					}
					else if (name === 'style') {
						this.bindInlineStyle(node, value, null, fors);
					}
					else {
						this.bindNormalAttribute(node, value, name, fors);
					}
				}, this);
			}
		},

		/**
		 * 绑定节点class
		 * @param   {DOMElement}      node
		 * @param   {String}          bindField
		 * @param   {String}          classname
		 * @param   {Array}           fors
		 */
		bindClassName: function(node, bindField, classname, fors) {
			var init = this.getData(bindField);
			var isObject = util.isObject(init);
			var isSingle = util.isString(init) || util.isBoolean(init);

			// single class
			if (isSingle) {
				this.updateNodeClassName(node, init, null, classname);
			}
			// classObject
			else if (isObject) {
				this.bindClassNameObject(node, init);
			}
			else {
				// v-for
				if (fors) {
					this.bindClassNameVfor(node, bindField, fors);
				}
				else {
					util.warn('model \'s '+ bindField + ' for binding class must be a type of Object, String or Boolean!');
				}
				return;
			}

			this.watcher.add(bindField, function(path, last, old) {
				if (isObject) {
					// 替换整个classObject
					if (util.isObject(last)) {
						this.bindClassNameObject(node, last, old);
					}
					// 只修改classObject的一个字段
					else if (util.isBoolean(last)) {
						this.updateNodeClassName(node, last, null, path.split('*').pop());
					}
				}
				else {
					this.updateNodeClassName(node, last, old, classname);
				}
			}, this);
		},

		/**
		 * classname in v-for
		 */
		bindClassNameVfor: function(node, bindField, fors) {
			var item = fors[0], index = fors[1], access = fors[2];
			var replace, key = this.getVforKey(bindField), classname = item[key];
			var path = access + '*' + key, watcher = this.watcher;

			if (util.isString(classname)) {
				replace = this.replaceVforIndex(classname, index);

				if (replace) {
					classname = replace;
				}
				else {
					watcher.watchAccess(path, function(last, old) {
						this.addClass(node, last);
						this.removeClass(node, old);
					}, this);
				}

				this.addClass(node, classname);
			}
			// classObject
			else if (util.isObject(classname)) {
				this.bindClassNameObject(node, classname);

				// 监测classObject一个字段修改
				util.each(classname, function(isAdd, cls) {
					watcher.watchAccess(path + '*' + cls, function(last, old) {
						this.updateNodeClassName(node, last, null, cls);
					}, this);
				}, this);

				// 监测替换整个classObject
				watcher.watchAccess(path, function(last, old) {
					this.bindClassNameObject(node, last, old);
				}, this);
			}
			else {
				util.warn(path + ' for binding class must be a type of Object, String or Boolean!');
			}
		},

		/**
		 * 通过classObject批量绑定或移除class
		 * @param   {DOMElement}  node
		 * @param   {object}      classObject  [定义classname组合的json]
		 * @param   {Object}      oldObject    [旧classname组合的json]
		 */
		bindClassNameObject: function(node, classObject, oldObject) {
			// 新增值
			util.each(classObject, function(isAdd, cls) {
				this.updateNodeClassName(node, isAdd, null, cls);
			}, this);

			// 移除旧值
			util.each(oldObject, function(isAdd, cls) {
				this.updateNodeClassName(node, false, null, cls);
			}, this);
		},

		/**
		 * 绑定节点style
		 * @param   {DOMElement}  node
		 * @param   {String}      bindField   [数据绑定字段]
		 * @param   {String}      propperty   [行内样式属性]
		 * @param   {Array}       fors
		 */
		bindInlineStyle: function(node, bindField, propperty, fors) {
			var init = this.getData(bindField);
			var isObject = util.isObject(init);
			var isString = util.isString(init);

			// styleString
			if (isString) {
				this.updateNodeStyle(node, propperty, init);
			}
			// styleObject
			else if (isObject) {
				this.bindInlineStyleObject(node, init);
			}
			else {
				// v-for
				if (fors) {
					this.bindInlineStyleVfor(node, bindField, fors);
				}
				else {
					util.warn('model \'s '+ bindField + ' for binding style must be a type of Object or String!');
				}
				return;
			}

			this.watcher.add(bindField, function(path, last, old) {
				if (isObject) {
					// 替换整个styleObject，保留旧样式定义
					if (util.isObject(last)) {
						this.bindInlineStyleObject(node, last, old);
					}
					// 只修改styleObject的一个字段
					else if (util.isString(last)) {
						this.updateNodeStyle(node, path.split('*').pop(), last);
					}
				}
				else {
					this.updateNodeStyle(node, propperty, last);
				}
			}, this);
		},

		/**
		 * inline-style in v-for
		 */
		bindInlineStyleVfor: function(node, bindField, fors) {
			var item = fors[0], index = fors[1], access = fors[2];
			var key = this.getVforKey(bindField), style = item[key];
			var replace, path = access + '*' + key, watcher = this.watcher;

			if (util.isString(style)) {
				replace = this.replaceVforIndex(style, index);

				if (replace) {
					style = replace;
				}
				else {
					// 监测访问路径
					watcher.watchAccess(path, function(last, old) {
						this.updateNodeStyle(node, key, last);
					}, this);
				}

				this.updateNodeStyle(node, key, style);
			}
			// styleObject
			else if (util.isObject(style)) {
				this.bindInlineStyleObject(node, style);

				// 监测单个字段修改
				util.each(style, function(value, propperty) {
					watcher.watchAccess(path + '*' + propperty, function(last, old) {
						this.updateNodeStyle(node, propperty, last);
					}, this);
				}, this);

				// 监测替换整个styleObject
				watcher.watchAccess(path, function(last, old) {
					this.bindInlineStyleObject(node, last, old);
				}, this);
			}
			else {
				util.warn(path + ' for binding style must be a type of Object or String!');
			}
		},

		/**
		 * 通过styleObject批量绑定或移除行内样式
		 * @param   {DOMElement}  node
		 * @param   {object}      styleObject  [定义style组的json]
		 * @param   {object}      oldObject    [旧style组的json]
		 */
		bindInlineStyleObject: function(node, styleObject, oldObject) {
			// 新值
			util.each(styleObject, function(value, propperty) {
				this.updateNodeStyle(node, propperty, value);
			}, this);

			// 移除旧值
			util.each(oldObject, function(value, propperty) {
				this.updateNodeStyle(node, propperty, null);
			}, this);
		},

		/**
		 * 绑定节点属性
		 * @param   {DOMElement}  node
		 * @param   {String}      bindField  [数据绑定字段]
		 * @param   {String}      attr
		 * @param   {Array}       fors
		 */
		bindNormalAttribute: function(node, bindField, attr, fors) {
			var value, key, replace, item, index, path;

			// v-for
			if (fors) {
				item = fors[0], index = fors[1], path = fors[2];
				key = this.getVforKey(bindField);
				replace = this.replaceVforIndex(key, index);
				if (replace) {
					value = replace;
				}
				else {
					value = item[key];
					// 监测访问路径
					this.watcher.watchAccess(path + '*' + key, function(last, old) {
						this.updateNodeAttribute(node, key, last);
					}, this);
				}
			}
			else {
				value = this.getData(bindField);

				this.watcher.add(bindField, function(path, last) {
					this.updateNodeAttribute(node, attr, last);
				}, this);
			}

			this.updateNodeAttribute(node, attr, value);
		},

		/**
		 * v-on 动态绑定一个或多个事件
		 */
		handleOn: function(node, value, attr) {
			var val, param, props;
			var evt = this.removeSpace(attr);
			var func = this.removeSpace(value);

			// 单个事件 v-on:click
			if (evt.indexOf(':') !== -1) {
				val = this.getStringKeyValue(evt);
				param = this.stringToParameters(func);
				this.handleOnEvent(node, param[0], param[1], val);
			}
			// 多个事件 v-on="{click: xxx, mouseenter: yyy, mouseleave: zzz}"
			else {
				props = this.jsonStringToArray(func);
				util.each(props, function(prop) {
					val = prop.name;
					param = this.stringToParameters(prop.value);
					this.handleOnEvent(node, param[0], param[1], val);
				}, this);
			}
		},

		/**
		 * 节点绑定事件
		 */
		handleOnEvent: function(node, bindField, args, evt) {
			var init = this.getData(bindField);
			this.updateNodeEvent(node, evt, init, null, args, bindField);

			this.watcher.add(bindField, function(path, last, old) {
				this.updateNodeEvent(node, evt, last, old, args, bindField);
			}, this);
		},

		/**
		 * v-model 表单控件双向绑定
		 */
		handleModel: function(node) {
			var tagName = node.tagName.toLowerCase();
			var type = tagName === 'input' ? this.getAttr(node, 'type') : tagName;

			if (this.$inputs.indexOf(tagName) === -1) {
				util.warn('v-model only for use in ' + this.$inputs.join(', '));
				return;
			}

			// 根据不同表单类型绑定数据监测方法
			switch (type) {
				case 'text'    :
				case 'textarea': this.handleModelText.apply(this, arguments); break;
				case 'radio'   : this.handleModelRadio.apply(this, arguments); break;
				case 'checkbox': this.handleModelCheckbox.apply(this, arguments); break;
				case 'select'  : this.handleModelSelect.apply(this, arguments); break;
			}
		},

		/**
		 * v-model for text, textarea
		 */
		handleModelText: function(node, value) {
			var init = this.getData(value);
			this.bindModelTextEvent(node, value).updateNodeFormTextValue(node, init);

			this.watcher.add(value, function(path, last) {
				this.updateNodeFormTextValue(node, last);
			}, this);
		},

		/**
		 * text, textarea绑定数据监测事件
		 * @param   {Input}   node
		 * @param   {String}  field
		 */
		bindModelTextEvent: function(node, field) {
			var self = this, composeLock = false;

			// 解决中文输入时input事件在未选择词组时的触发问题
			// https://developer.mozilla.org/zh-CN/docs/Web/Events/compositionstart
			this.addEvent(node, 'compositionstart', function() {
				composeLock = true;
			});
			this.addEvent(node, 'compositionend', function() {
				composeLock = false;
			});

			// input事件(实时触发)
			this.addEvent(node, 'input', function() {
				if (!composeLock) {
					self.setData(field, this.value);
				}
			});

			// change事件(失去焦点触发)
			this.addEvent(node, 'change', function() {
				self.setData(field, this.value);
			});

			return this;
		},

		/**
		 * v-model for radio
		 */
		handleModelRadio: function(node, value) {
			var init = this.getData(value);
			this.bindModelRadioEvent(node, value).updateNodeFormRadioChecked(node, init);

			this.watcher.add(value, function(path, last) {
				this.updateNodeFormRadioChecked(node, last);
			}, this);
		},

		/**
		 * radio绑定数据监测事件
		 * @param   {Input}   node
		 * @param   {String}  field
		 */
		bindModelRadioEvent: function(node, field) {
			var self = this;

			this.addEvent(node, 'change', function() {
				self.setData(field, this.value);
			});

			return this;
		},

		/**
		 * v-model for checkbox
		 */
		handleModelCheckbox: function(node, value) {
			var init = this.getData(value);
			this.bindCheckboxEvent(node, value).updateNodeFormCheckboxChecked(node, init);

			this.watcher.add(value, function() {
				this.updateNodeFormCheckboxChecked(node, this.getData(value));
			}, this);
		},

		/**
		 * checkbox绑定数据监测事件
		 * @param   {Input}   node
		 * @param   {String}  field
		 */
		bindCheckboxEvent: function(node, field) {
			var self = this;
			var array = this.getData(field);

			this.addEvent(node, 'change', function() {
				var index, value = this.value, checked = this.checked;

				// 多个checkbox
				if (util.isArray(array)) {
					index = array.indexOf(value);
					if (checked) {
						if (index === -1) {
							array.push(value);
						}
					}
					else {
						if (index !== -1) {
							array.splice(index, 1);
						}
					}
				}
				// 单个checkbox
				else if (util.isBoolean(array)) {
					self.setData(field, checked);
				}
			});

			return this;
		},

		/**
		 * v-model for select
		 */
		handleModelSelect: function(node, value) {
			var self = this;
			var options = node.options;
			var init = this.getData(value);
			var multi = this.hasAttr(node, 'multiple');
			var option, i, leng = options.length, selects = [], isDefined;

			// 数据模型定义为单选
			if (util.isString(init)) {
				if (multi) {
					util.warn('select cannot be multiple when your model set \'' + value + '\' to noArray!');
					return;
				}
				isDefined = Boolean(init);
			}
			// 定义为多选
			else if (util.isArray(init)) {
				if (!multi) {
					util.warn('your model \'' + value + '\' cannot set as Array when select has no multiple propperty!');
					return;
				}
				isDefined = init.length > 0;
			}
			else {
				util.warn(value + ' must be a type of String or Array!');
				return;
			}

			// 数据模型中定义初始的选中状态
			if (isDefined) {
				this.updateNodeFormSelectCheck(node, init, multi);
			}
			// 模板中定义初始状态
			else {
				// 获取选中状态
				for (i = 0; i < leng; i++) {
					option = options[i];
					if (option.selected) {
						selects.push(option.value);
					}
				}

				this.setData(value, multi ? selects : selects[0]);
			}

			this.bindSelectEvent(node, value, multi);

			this.watcher.add(value, function() {
				this.updateNodeFormSelectCheck(node, this.getData(value), multi);
			}, this);
		},

		/**
		 * select绑定数据监测事件
		 * @param   {Select}   node
		 * @param   {String}   field
		 * @param   {Boolean}  multi
		 */
		bindSelectEvent: function(node, field, multi) {
			var self = this;

			this.addEvent(node, 'change', function() {
				var options = this.options;
				var i, option, leng = options.length, selects = [];

				for (i = 0; i < leng; i++) {
					option = options[i];
					if (option.selected) {
						selects.push(option.value);
					}
				}

				self.setData(field, multi ? selects : selects[0]);
			});

			return this;
		},

		/**
		 * v-for 基于源数据重复的动态列表
		 */
		handleFor: function(node, value, attr, fors) {
			var match = value.match(/(.*) in (.*)/);
			var alias = match[1];
			var field = match[2];
			var scope = {}, level = 0;
			var watcher = this.watcher;
			var parent = node.parentNode;
			var key = this.getVforKey(field);
			var template, extras, array = this.getData(field);

			if (key) {
				scope = fors[3];
				level = fors[5];
				array = fors[0][key];
				field = fors[2] + '*' + key;
			}

			if (!util.isArray(array)) {
				parent.removeChild(node);
				return;
			}

			template = this.buildVforTemplate(node, array, field, scope, alias, level);

			parent.replaceChild(template, node);

			// differ数组信息
			extras = [field, scope, alias, level];

			// 监测根列表数据的变化
			if (!fors) {
				watcher.add(field, function(path, last, old) {
					// 更新数组的某一项
					if (path !== field) {
						watcher.triggerAccess(path, last, old);
					}
					// 更新整个根数组
					else {
						this.differVfors(parent, node, last, old, extras);
					}
				}, this);
			}
			// 嵌套vfor
			else {
				watcher.watchAccess(field, function(last, old) {
					this.differVfors(parent, node, last, old, extras);
				}, this);
			}
		},

		/**
		 * 根据源数组构建循环板块集合
		 * @param   {DOMElement}  node   [重复节点]
		 * @param   {Array}       array  [源数组]
		 * @param   {String}      field  [访问路径]
		 * @param   {Object}      scope  [循环中对象取值范围]
		 * @param   {String}      alias  [当前循环对象别名]
		 * @param   {Number}      level  [当前循环层级]
		 * @return  {Fragment}           [板块集合]
		 */
		buildVforTemplate: function(node, array, field, scope, alias, level) {
			var fragments = this.createFragment();

			level++;

			// 构建重复片段
			util.each(array, function(item, index) {
				var path = field + '*' + index;
				var cloneNode = node.cloneNode(true);
				var fors = [item, index, path, scope, alias, level];

				// 缓存取值范围
				scope[alias] = item;
				// 解析/编译板块
				this.parseElement(cloneNode, true, fors);
				// 定义私有标记属性
				util.defineProperty(cloneNode, '_vfor_alias', alias, false, false, false);

				fragments.appendChild(cloneNode);
			}, this);

			return fragments;
		},

		/**
		 * 数组操作同步更新vfor循环体
		 * @param   {DOMElement}  parent    [父节点]
		 * @param   {DOMElement}  node      [初始模板片段]
		 * @param   {Array}       newArray  [新的数据重复列表]
		 * @param   {String}      method    [数组操作]
		 * @param   {Array}       extras    [differ信息]
		 */
		differVfors: function(parent, node, newArray, method, extras) {
			var field = extras[0];
			var alias = extras[2];
			var firstChild, lastChild;
			var watcher = this.watcher;

			switch (method) {
				case 'push':
					this.pushVforArray.apply(this, arguments);
					break;
				case 'pop':
					lastChild = this.getVforLastChild(parent, alias);
					parent.removeChild(lastChild);
					break;
				case 'unshift':
					watcher.backwardAccess(field, newArray.length);
					this.unshiftVforArray.apply(this, arguments);
					break;
				case 'shift':
					firstChild = this.getVforFirstChild(parent, alias);
					watcher.forwardAccess(field, newArray.length);
					parent.removeChild(firstChild);
					break;
				case 'splice':
					this.spliceVforArray.apply(this, arguments);
					break;
				case 'sort':
					this.sortVforArray.apply(this, arguments);
					break;
				case 'reverse':
					this.reverseVforArray.apply(this, arguments);
					break;
			}
		},

		/**
		 * 获取vfor循环体的第一个子节点
		 * @param   {DOMElement}  parent  [父节点]
		 * @param   {String}      alias   [循环体对象别名]
		 * @return  {FirstChild}
		 */
		getVforFirstChild: function(parent, alias) {
			var i, firstChild, child;
			var childNodes = parent.childNodes;
			for (i = 0; i < childNodes.length; i++) {
				child = childNodes[i];
				if (child._vfor_alias === alias) {
					firstChild = child;
					break;
				}
			}
			return firstChild;
		},

		/**
		 * 获取vfor循环体的最后一个子节点
		 * @param   {DOMElement}  parent   [父节点]
		 * @param   {String}      alias    [循环体对象别名]
		 * @return  {LastChild}
		 */
		getVforLastChild: function(parent, alias) {
			var i, lastChild, child;
			var childNodes = parent.childNodes;
			for (i = childNodes.length - 1; i > -1 ; i--) {
				child = childNodes[i];
				if (child._vfor_alias === alias) {
					lastChild = child;
					break;
				}
			}
			return lastChild;
		},

		/**
		 * 在循环体数组的最后追加一条数据 array.push
		 */
		pushVforArray: function(parent, node, newArray, method, extras) {
			var last = newArray.length - 1;
			var fragment = this.createFragment();
			var cloneNode = node.cloneNode(true);
			var field = extras[0], scope = extras[1], alias = extras[2], level = extras[3];

			// 循环体定义
			scope[alias] = newArray[last];

			// 解析节点
			this.parseElement(cloneNode, true, [newArray[last], last, field + '*' + last, scope, alias, level]);
			fragment.appendChild(cloneNode);

			parent.appendChild(fragment);
		},

		/**
		 * 在循环体数组最前面追加一条数据 array.unshift
		 */
		unshiftVforArray: function(parent, node, newArray, method, extras) {
			var firstChild;
			var fragment = this.createFragment();
			var cloneNode = node.cloneNode(true);
			var field = extras[0], scope = extras[1], alias = extras[2], level = extras[3];

			// 循环体定义
			scope[alias] = newArray[0];

			// 解析节点
			this.parseElement(cloneNode, true, [newArray[0], 0, field + '*' + 0, scope, alias, level]);
			fragment.appendChild(cloneNode);

			firstChild = this.getVforFirstChild(parent, alias);
			parent.insertBefore(fragment, firstChild);
		},

		/**
		 * 循环体数组切割/替换数据 array.splice
		 */
		spliceVforArray: function() {},

		/**
		 * 循环体数组重新排序 array.sort
		 */
		sortVforArray: function() {},

		/**
		 * 循环体数组顺序反转 array.reverse
		 */
		reverseVforArray: function() {},


		/********** 视图刷新方法 **********/

		/**
		 * 更新节点的文本内容 realize v-text
		 * @param   {DOMElement}  node
		 * @param   {String}      text
		 */
		updateNodeTextContent: function(node, text) {
			node.textContent = (node._vm_text_prefix || '') + String(text) + (node._vm_text_suffix || '');
			return this;
		},

		/**
		 * 更新节点的html内容 realize v-html
		 * @param   {DOMElement}  node
		 * @param   {String}      html
		 */
		updateNodeHtmlContent: function(node, html) {
			this.empty(node);
			node.appendChild(this.stringToFragment(String(html)));
		},

		/**
		 * 更新节点的显示隐藏 realize v-show
		 * 行内样式display=''不会影响由classname中的定义
		 * _vm_visible_display用于缓存节点行内样式的display显示值
		 * @param   {DOMElement}  node
		 * @param   {Boolean}     show    [是否显示]
		 */
		updateNodeDisplay: function(node, show) {
			var display, inlineStyle, styles;

			if (!node._vm_visible_display) {
				inlineStyle = this.removeSpace(this.getAttr(node, 'style'));

				if (inlineStyle && inlineStyle.indexOf('display') !== -1) {
					styles = inlineStyle.split(';');

					util.each(styles, function(style) {
						if (style.indexOf('display') !== -1) {
							display = this.getStringKeyValue(style);
						}
					}, this);
				}

				if (display !== 'none') {
					node._vm_visible_display = display;
				}
			}

			node.style.display = show ? (node._vm_visible_display || '') : 'none';
		},

		/**
		 * 更新节点内容的渲染 realize v-if
		 * @param   {DOMElement}  node
		 * @param   {Boolean}     render  [是否渲染]
		 * @param   {Boolean}     init    [是否是初始化编译]
		 */
		updateNodeRenderContent: function(node, render, init) {
			if (!node._vm_render_content) {
				node._vm_render_content = node.innerHTML;
			}

			if (!render) {
				this.empty(node);
			}
			else {
				if (!init) {
					node.appendChild(this.stringToFragment(node._vm_render_content));
				}

				// 重新编译节点内容
				this.parseElement(node, true);
			}
		},

		/**
		 * 更新节点的attribute realize v-bind
		 * @param   {DOMElement}  node
		 * @param   {String}      attribute
		 * @param   {String}      value
		 */
		updateNodeAttribute: function(node, attribute, value) {
			if (value === null) {
				this.removeAttr.apply(this, arguments);
			}
			else {
				// setAttribute不适合用于表单元素的value
				// https://developer.mozilla.org/en-US/docs/Web/API/Element/setAttribute
				if (attribute === 'value' && (this.$inputs.indexOf(node.tagName.toLowerCase()) !== -1)) {
					node.value = value;
				}
				else {
					this.setAttr.apply(this, arguments);
				}
			}
		},

		/**
		 * 更新节点的classname realize v-bind:class
		 * @param   {DOMElement}          node
		 * @param   {String|Boolean}      newValue
		 * @param   {String|Boolean}      oldValue
		 * @param   {String}              classname
		 */
		updateNodeClassName: function(node, newValue, oldValue, classname) {
			// 指定classname，变化值由newValue布尔值决定
			if (classname) {
				if (newValue === true) {
					this.addClass(node, classname);
				}
				else if (newValue === false) {
					this.removeClass(node, classname);
				}
			}
			// 未指定classname，变化值由newValue的值决定
			else {
				if (newValue) {
					this.addClass(node, newValue);
				}

				if (oldValue) {
					this.removeClass(node, oldValue);
				}
			}
		},

		/**
		 * 更新节点的style realize v-bind:style
		 * @param   {DOMElement}  node
		 * @param   {String}      propperty  [属性名称]
		 * @param   {String}      value      [样式值]
		 */
		updateNodeStyle: function(node, propperty, value) {
			node.style[propperty] = value;
		},

		/**
		 * 更新节点绑定事件的回调函数
		 * @param   {DOMElement}  node
		 * @param   {String}      evt
		 * @param   {Function}    newFunc  [新callback]
		 * @param   {Function}    oldFunc  [旧callback]
		 * @param   {Array}       params   [回调参数]
		 * @param   {String}      field    [回调对应监测字段]
		 */
		updateNodeEvent: function(node, evt, newFunc, oldFunc, params, field) {
			var listeners = this.$listeners;
			var targetListener = listeners[field];

			if (util.isFunc(newFunc)) {
				listeners[field] = function(e) {
					var args = [];
					util.each(params, function(param) {
						args.push(param === '$event' ? e : param);
					});

					// 未指定参数，则原生事件对象作为唯一参数
					if (!args.length) {
						args.push(e);
					}

					newFunc.apply(this, args);
				}

				this.addEvent(node, evt, listeners[field]);
			}

			if (util.isFunc(oldFunc)) {
				this.removeEvent(node, evt, targetListener);
			}
		},

		/**
		 * 更新text或textarea的value
		 * @param   {Input}  text
		 * @param   {String} value
		 */
		updateNodeFormTextValue: function(text, value) {
			if (text.value !== value) {
				text.value = value;
			}
		},

		/**
		 * 更新radio的激活状态
		 * @param   {Input}  radio
		 * @param   {String} value
		 */
		updateNodeFormRadioChecked: function(radio, value) {
			radio.checked = radio.value === (util.isNumber(value) ? String(value) : value);
		},

		/**
		 * 更新checkbox的激活状态
		 * @param   {Input}          checkbox
		 * @param   {Array|Boolean}  values      [激活数组或状态]
		 */
		updateNodeFormCheckboxChecked: function(checkbox, values) {
			if (!util.isArray(values) && !util.isBoolean(values)) {
				util.warn('checkbox v-model value must be a type of Boolean or Array!');
				return;
			}
			checkbox.checked = util.isBoolean(values) ? values : (values.indexOf(checkbox.value) !== -1);
		},

		/**
		 * 更新select的激活状态
		 * @param   {Select}         select
		 * @param   {Array|String}   selected  [选中值]
		 * @param   {Boolean}        multi
		 */
		updateNodeFormSelectCheck: function(select, selected, multi) {
			var options = select.options;
			var i, option, value, leng = options.length;

			for (i = 0; i < leng; i++) {
				option = options[i];
				value = option.value;
				option.selected = multi ? selected.indexOf(value) !== -1 : selected === value;
			}
		}
	}

	return VM;
});