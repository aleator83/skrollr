/*
 * TODO
 *	-foreach skrollabls
 *		-iterate over all keyFrames in order (small to large)
 *		-set properties from small keyFrames to large keyFrames if missing to allow starting from !== 0
 * 			Otherwise when starting from e.g. 500, and there are keyFrames for 100 and 300 we miss the values from 100
 *
 *	-Did this. Now I think it would make more sense to interpolate the frames in between.
 *	-And what about other direction (right hand)?
 */

(function(document, undefined) {
	var noop = function() {};

	var M = Math;

	var rxKeyframeAttribute = /^data-(\d+)$/;
	var rxPropSplit = /:|;/g;
	var rxPropEasing = /([a-z-]+)\[(\w+)\]/;
	var rxCamelCase = /-([a-z])/g;
	var rxNumericValue = /(?:^|\s+)((?:-|\+)?[0-9.]+)(%|px|em|ex|pt|in|cm|mm|pc|deg)?/g;
	var rxTransformValue = /((?:rotate)|(?:scale(?:X|Y)?)|(?:skew(?:X|Y)?))\((.+?)\)/g;

	var bounceHelper = function f(x, a) {
		return 1 - M.abs(3 * M.cos(x * a * 1.028) / a);
	};

	var easings = {
		begin: function() {
			return 0;
		},
		end: function() {
			return 1;
		},
		linear: function(p) {
			return p;
		},
		quadratic: function(p) {
			return p * p;
		},
		cubic: function(p) {
			return p * p * p * p;
		},
		swing: function(p) {
			return (-M.cos(p * M.PI) / 2) + .5;
		},
		//https://www.desmos.com/calculator/tbr20s8vd2
		bounce: function(p, a) {
			switch(true) {
				case (p <= .5083):
					a = 3; break;
				case (p <= .8489):
					a = 9; break;
				case (p <= .96208):
					a = 27; break;
				case (p <= .99981):
					a = 91; break;
				default:
					return 1;
			}

			return bounceHelper(p, a);
		}
	};

	/**
	 * List of parser and steps for different kind of value types.
	 * Parser: Parses a value to a specific format which a Step can handle.
	 * Step: A function which gets the output of two Parsers and interpolates the value for a given progress.
	 */
	var parsersAndSteps = {
		//Simple constant values which won't be interpolated.
		constant: {
			/**
			* Doesn't interpolate at all.
			*/
			step: function(val) {
				return val;
			}
		},
		//Simple numeric values with unit which can easily be interpolated.
		//Not used directly, only by composedNumeric.
		numeric: {
			/**
			 * Parses a single numeric value with optional unit.
			 * @return An array with the numeric value at first position and the unit at second position.
			 */
			parser: function(val, match) {
				rxNumericValue.lastIndex = 0;

				match = rxNumericValue.exec(val);

				if(match === null) {
					throw 'Can\'t parse "' + val + '" as numeric value.'
				}

				return [parseFloat(match[1], 10), match[2] || ''];
			},
			/**
			 * Calculates the new value by interpolating between val1 and val2 using the given easing.
			 * If only the first parameter is specified, it just sets the value.
			 */
			step: function(val1, val2, progress) {
				if(val2 === undefined) {
					return val1[0] + val1[1];
				}

				//Check if the units are the same
				if(val1[1] !== val2[1]) {
					throw "Can't interpolate between '" + val[0] + val1[1] + "' and '" + val1[0] + val2[1] + "'";
				}

				return (val1[0] + ((val2[0] - val1[0]) * progress)) + val1[1];
			}
		},
		//Values which are composed of multipe numeric values like "0% 0%"
		composedNumeric: {
			/**
			 * Parses a value which is composed of multiple numeric values separated by a single space.
			 * @return An array of arrays. See "numeric.parser" for info about the individual arrays.
			 */
			parser: function(all, values) {
				values = [];

				for(var i = 0; i < all.length; i++) {
					//Use the simple numeric parser for the indiviual values
					values.push(parsersAndSteps.numeric.parser(all[i]));
				}

				return values;
			},
			step: function(val1, val2, progress, stepped) {
				stepped = [];

				if(val2 === undefined) {
					for(var i = 0; i < val1.length; i++) {
						stepped.push(parsersAndSteps.numeric.step(val1[i]));
					}
				} else {
					if(val1.length !== val2.length) {
						throw "Can't interpolate between two composed values with different number of values.";
					}

					for(var i = 0; i < val1.length; i++) {
						stepped.push(parsersAndSteps.numeric.step(val1[i], val2[i], progress));
					}
				}

				return stepped.join(' ');
			}
		},
		transform: {
			parser: function(all, values, match) {
				values = [];

				for(var i = 0; i < all.length; i++) {
					rxTransformValue.lastIndex = 0;

					match = rxTransformValue.exec(all[i]);

					//The transform function
					values.push(match[1]);

					//Use the simple numeric parser for the indiviual values
					values.push(parsersAndSteps.numeric.parser(match[2]));
				}

				return values;
			},
			step: function(val1, val2, progress, ret) {
				ret = [];

				if(val2 === undefined) {
					for(var i = 0; i < val1.length - 1; i += 2) {
						ret.push(val1[i] + '(' + val1[i + 1].join('') + ')');
					}
				} else {
					for(var i = 0; i < val1.length - 1; i += 2) {
						ret.push(val1[i] + '(' + parsersAndSteps.numeric.step(val1[i + 1], val2[i + 1], progress) + ')');
					}
				}

				return ret.join(' ');
			}
		},
		//TODO
		color: {
			parser: function(val) {
				return val;
			},
			step: function(val1, val2, progress, easing) {
				return val1;
			}
		}
	};

	/**
	 * Constructor.
	 */
	function Skrollr(options) {
		var self = this;

		options = options || {};

		self.easings = easings;

		//We allow defining custom easings or overwrite existing
		if(options.easing) {
			for(var e in options.easing) {
				self.easings[e] = options.easing[e];
			}
		}

		//The container element. The parent of all skrollables.
		self.container = document.getElementsByTagName('body')[0];

		//Scale factor to scale keyFrames.
		self.scale = options.scale || 1;

		self.listeners = {
			//Function to be called when scolling
			scroll: options.scroll || noop
		};

		/*
			A list of all elements which should be animated associated with their the metadata.
			Exmaple skrollable with two keyFrames animating from 100px width to 20px:

			skrollable = {
				element: <the DOM element>,
				keyFrames: [
					{
						frame: 100,
						props: {
							width: {
								value: [100, 'px'],
								step: <reference to step function calculating the interpolation>,
								easing: <reference to easing function>
							}
						}
					},
					{
						frame: 200,
						props: {
							width: {
								value: [20, 'px'],
								step: <reference to step function calculating the interpolation>,
								easing: <reference to easing function>
							}
						}
					}
				]
			};
		*/
		self.skrollables = [];

		//Will contain the max keyFrame value available.
		self.maxKeyFrame = 0;



		var allElements = self.container.getElementsByTagName('*');

		//Iterate over all elements inside the container.
		for(var i = 0; i < allElements.length; i++) {
			var
				el = allElements[i];
				fx = {},
				keyFrames = [];


			//Iterate over all attributes and search for keyframe attributes.
			for (var k = 0; k < el.attributes.length; k++) {
				var
					attr = el.attributes[k],
					match = attr.name.match(rxKeyframeAttribute);

				if(match !== null) {
					var frame = (match[1] | 0) * self.scale;

					keyFrames.push({
						frame: frame,
						props: attr.value
					});

					if(frame > this.maxKeyFrame) {
						self.maxKeyFrame = frame;
					}
				}
			}


			//Does this element have keyframes?
			if(keyFrames.length) {
				//Make sure they are in order
				keyFrames.sort(function(a, b) {
					return a.frame - b.frame;
				});

				var sk = {
					element: el,
					keyFrames: keyFrames
				};

				//Parse the property string to objects
				self._parseProps(sk);

				//Fill keyFrames with missing properties from left and right
				self._fillProps(sk);

				self.skrollables.push(sk);

				el.className += ' skrollable';
			}
		}


		//Add a dummy element in order to get a large enough scrollbar
		self.dummy = document.createElement('div');

		var s = self.dummy.style;

		s.width = '1px';
		s.height = (self.maxKeyFrame + getViewportHeight()) + 'px';
		s.position = 'absolute';
		s.left = s.top = '0px';
		s.zIndex = '0';

		self.container.appendChild(self.dummy);

		//TODO add some throttle to scroll event
		self.onScroll = function() {
			var top = getScrollTop();

			self.listeners.scroll(top);

			self._render(top);
		};

		//Make sure everything loads correctly
		self.onScroll(getScrollTop());

		//Let's go
		addEvent(document, 'scroll', self.onScroll);

		return self;
	}

	Skrollr.prototype.setScrollTop = function(top) {
		pageYOffset = top;
		document.body.scrollTop = top;
		document.documentElement.scrollTop = top;

		this.onScroll();
	};

	/**
	 * Calculate and sets the style properties for the element at the given frame
	 */
	Skrollr.prototype._calcSteps = function(skrollable, frame) {
		var frames = skrollable.keyFrames;

		//We are before the first frame, don't do anything
		if(frame < frames[0].frame) {
			setStyle(skrollable.element, 'display', 'none');
		}
		//We are after the last frame, the element gets all props from last keyFrame
		else if(frame > frames[frames.length - 1].frame) {
			setStyle(skrollable.element, 'display', 'block');

			var last = frames[frames.length - 1], value;

			for(var key in last.props) {
				if(hasProp(last.props, key)) {
					value = last.props[key].step(last.props[key].value);

					setStyle(skrollable.element, key, value);
				}
			}
		}
		//We are between two frames
		else {
			setStyle(skrollable.element, 'display', 'block');

			//Find out between which two keyFrames we are right now
			for(var i = 0; i < frames.length - 1; i++) {
				if(frame >= frames[i].frame && frame <= frames[i + 1].frame) {
					var left, right;

					left = frames[i];
					right = frames[i + 1];

					for(var key in left.props) {
						if(hasProp(left.props, key)) {

							//If the left keyframe has a property which the right doesn't, we just set it without interprolating
							if(!hasProp(right.props, key)) {
								var value = left.props[key].step(left.props[key].value);

								setStyle(skrollable.element, key, value);
							} else {
								var progress = (frame - left.frame) / (right.frame - left.frame);

								progress = left.props[key].easing(progress);

								var value = left.props[key].step(left.props[key].value, right.props[key].value, progress);

								setStyle(skrollable.element, key, value);
							}
						}
					}

					break;
				}
			}
		}
	};

	/**
	 * Renders all elements
	 */
	Skrollr.prototype._render = function(top) {
		for(var i = 0; i < this.skrollables.length; i++) {
			this._calcSteps(this.skrollables[i], top);
		}

		return this;
	};

	/**
	 * Parses the properties for each keyFrame of the given skrollable.
	 */
	Skrollr.prototype._parseProps = function(skrollable) {
		var self = this;

		//Iterate over all keyframes
		for(var i = 0; i < skrollable.keyFrames.length; i++) {
			var
				frame = skrollable.keyFrames[i],
				//Get all properties and values in an array
				allProps = frame.props.split(rxPropSplit),
				prop, value, easing;

			frame.props = {};

			//Iterate over all props and values (+2 because [prop,value,prop,value,...])
			for(var k = 0; k < allProps.length - 1; k += 2) {
				prop = allProps[k];
				value = allProps[k + 1];
				easing = prop.match(rxPropEasing);

				//Is there an easing specified for this prop?
				if(easing !== null) {
					prop = easing[1];
					easing = easing[2];
				} else {
					easing = 'linear';
				}

				value = self._parseProp(value);

				//Save the prop for this keyframe with his value and easing function
				frame.props[prop] = {
					value: value.value,
					step: value.step,
					easing: self.easings[easing]
				};
			}
		}
	};

	/**
	 * Parses a value using a parser. Tries to guess which parser to use.
	 */
	Skrollr.prototype._parseProp = function(val) {
		//Guess what type of value it is
		switch (false) {
			//Could be a transform value
			case !(m = val.match(rxTransformValue)):
				val = parsersAndSteps.transform.parser(m);

				return {
					value: val,
					step: parsersAndSteps.transform.step
				};
			//Could be a color
			case !(m = val.match(/bbbbbbbbbbbbbbbbbbbbbb/)):
				break;
			//Could be a numeric value
			case !(m = val.match(rxNumericValue)):
				val = parsersAndSteps.composedNumeric.parser(m);

				return {
					value: val,
					step: parsersAndSteps.composedNumeric.step
				};
			//Must be a constant value
			default:
				return {
					value: val,
					step: parsersAndSteps.constant.step
				}
		}
	}

	/**
	 * Fills the keyFrames with missing left hand properties.
	 * If keyFrame 1 has property X and keyFrame 2 is missing X,
	 * but keyFrame 3 has X again, then we need to assign X to keyFrame 2 too.
	 *
	 * @param sk A skrollable.
	 */
	Skrollr.prototype._fillProps = function(sk) {
		//Will collect the properties keyFrame by keyFrame
		var propList = {};

		//Iterate over all keyFrames from left to right
		for(var i = 0; i < sk.keyFrames.length; i++) {
			this._fillPropForFrame(sk.keyFrames[i], propList);
		}

		//Now do the same from right to fill the last gaps

		propList = {};

		//Iterate over all keyFrames from right to left
		for(var i = sk.keyFrames.length - 1; i >= 0; i--) {
			this._fillPropForFrame(sk.keyFrames[i], propList);
		}
	};


	Skrollr.prototype._fillPropForFrame = function(frame, propList) {
		//For each keyframe iterate over all right hand properties and assign them,
		//but only if the current keyFrame doesn't have the property by itself
		for(var key in propList) {
			//The current frame misses this property, so assign it.
			if(!hasProp(frame.props, key)) {
				frame.props[key] = propList[key];
			}
		}

		//Iterate over all props of the current frame and collect them
		for(var key in frame.props) {
			propList[key] = frame.props[key];
		}
	};


	/*
		Helpers
	*/
	/**
	 * Gets the height of the viewport
	 */
	var getViewportHeight = function() {
		return document.documentElement.clientHeight;
	};

	/**
	 * Gets the window scroll top offset
	*/
	var getScrollTop = function() {
		return pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
	};

	/**
		Attach an event handler to a DOM element
	*/
	var addEvent = function(el, type, fn) {
		if (el.addEventListener) {
			el.addEventListener(type, fn, false);
		} else if (elem.attachEvent) {
			el.attachEvent('on' + type, fn);
		}
	};

	/**
	 * Set the css property on the given element. Sets prefixed properties as well.
	 */
	var setStyle = function(el, prop, val) {
		//Camel case
		prop = prop.replace(rxCamelCase, function(str, p1) {
			return p1.toUpperCase();
		}).replace('-', '');

		//Unprefixed
		el.style[prop] = val;

		//Make first letter upper case for prefixed values
		prop = prop[0].toUpperCase() + prop.substr(1);

		//TODO maybe find some better way of doing this
		for(var i = 0, arr = ['O', 'Moz', 'webkit', 'ms']; i < arr.length; i++) {
			el.style[arr[i] + prop] = val;
		}
	};

	/**
	 * Returns true if the object has an own property with this name.
	 */
	var hasProp = function(obj, prop) {
		return Object.prototype.hasOwnProperty.call(obj, prop);
	};


	//Global api
	window.skrollr = {
		//Main entry point
		init: function(options) {
			return new Skrollr(options);
		}
	};
}(document));