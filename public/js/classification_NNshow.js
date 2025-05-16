const radius = 3;
const radius_data = 0.5;
const targetColor = getComputedStyle(document.documentElement).getPropertyValue('--plot-variance-warning-color').trim() || 'red';


class NetworkManager {
  constructor() {
    this.data = null;
    this.models = null;
    this.fileId = null;
  }

  parseDataCSV(csvText) {
    const parsedData = d3.csvParse(csvText, function (d) {
      return {
        time: +d.time,
        flux: d.flux === "" ? NaN : +d.flux,
        flux_err: d.flux_err === "" ? NaN : +d.flux_err,
        fwhm: d.fwhm === "" ? NaN : +d.fwhm,
        color: d.color,
        prob: +d.prob
        // pixel_shift: +d.pixel_shift
      };
    });
    return parsedData;
  }

  parseModelsCSV(csvText) {
    const lines = csvText.split('\n');
    const columns = lines[0].trim().split(',');
    const parsedData = d3.csvParse(csvText, function (d) {
      const rowData = {};
      columns.forEach((column, index) => {
        rowData[column] = +d[index];
      });
      return rowData;
    });
    return parsedData;
  }

  fetchFile(token, fileType, parseFunction) {
    const url = token ? `/get_${fileType}/${token}` : `/get_${fileType}/`;
    console.debug(`Fetching ${fileType}${token ? " with token" : ""}.`);

    return fetch(url)
      .then(response => {
        if (!response.ok) {
          throw new Error(`Network response was not ok, status: ${response.status}`);
        }
        this.fileId = parseInt(response.headers.get('file_id'));
        this.ViewIndex = parseInt(response.headers.get('view_index'));
        return response.arrayBuffer();
      })
      .then(arrayBuffer => {
        const decompressedData = pako.inflate(arrayBuffer, { to: 'string' });
        return decompressedData;
      })
      .then(response_data => parseFunction(response_data))
      .catch(error => {
        console.error(`Error during fetch ${fileType}:`, error);
        throw error;
      });
  }

  fetchData(token = null) {
    console.log(`Fetching files${token ? " with token" : ""}.`);
    return Promise.all([
      this.fetchFile(token, 'data', this.parseDataCSV),
      this.fetchFile(token, 'models', this.parseModelsCSV)
    ]).then(([newData, newModels]) => ({ newData, newModels }));
  }

  getNewData(token = null) {
    return new Promise((resolve, reject) => {
      this.fetchData(token)
        .then(({ newData, newModels }) => {
          this.data = newData;
          this.models = newModels;
          console.debug('Data:', this.data);
          console.debug('Models:', this.models);
          resolve();
        })
        .catch(error => {
          console.error('Error during getNewData:', error);
          reject(error);
        });
    });
  }

  submitData(postData) {
    return fetch("/post", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(postData),
    })
      .then(async (response) => {
        if (response.redirected) {//reached end of batch ->logout
          window.location.href = response.url;
          return; 
        }
        if (!response.ok) {
          throw new Error(`Network response was not ok, status: ${response.status}`);
        }
  
        const responseData = await response.json();
        if (responseData.logout) {
          window.location.href = "/logout";
          return new Promise(() => {}); // prevent further promise chain execution
        }
        const downloadToken = responseData.downloadToken;
  
        return downloadToken;
      })
      .catch((error) => {
        console.error("Error during POST request:", error);
        throw error; // Re-throw the error for further handling if needed
      });
  }
  
}


class GraphDimensions {
  constructor(svgSelector="#scatter-plot") {
    this.svgSelector = svgSelector;
    this.margin = { top: 5, right: 2, bottom: 50, left: 80 };
    this.width = 0;
    this.height = 0;
    this.innerWidthPlot = 0;
    this.innerHeightPlot = 0;
    this.interPanelPadding = 20;
    this.panelHeightFractions = [0.8];
    this.panelNames = ["flux", "prob"];
    this.panelHeights = [];
    this.lcPanelHeight = 0;
    this.fwhmPanelHeight = 0;
    this.pixelShiftPanelHeight = 0;
    this.panelTops = [];
  }

  update() {
    this.width = parseFloat(this.svg().style("width"));
    this.height = parseFloat(this.svg().style("height"));

    // Calculate inner dimensions of the chart area
    this.innerWidthPlot = this.width - this.margin.left - this.margin.right;
    this.panelHeights = this.panelHeightFractions.map(fraction => this.height * fraction);

    let sumOfPanelHeights = this.panelHeights.reduce((accumulator, currentValue) => accumulator + currentValue, 0);
    let interPanelPaddingTotal = (this.panelHeightFractions.length - 1) * this.interPanelPadding;
    this.innerHeightPlot = sumOfPanelHeights + interPanelPaddingTotal;

    // Calculate top positions of the panels
    for (let i = 0; i < this.panelHeightFractions.length; i++) {
      this.panelTops[i] = (
        this.margin.top
        + this.panelHeights.slice(0, i).reduce(
          (accumulator, currentValue) => accumulator + currentValue, 0
        )
        + i * this.interPanelPadding
      );
    }

    this.lcPanelHeight = 0.4 * this.height;
    this.fwhmPanelHeight = 0.2 * this.height;
    this.pixelShiftPanelHeight = 0.2 * this.height;

  }

  svg() {
    return d3.select(this.svgSelector);
  }

  get topFwhmPanel() {
    return this.margin.top + this.lcPanelHeight + this.interPanelPadding;
  }

  get topPixelShiftPanel() {
    return this.margin.top + this.lcPanelHeight + 2*this.interPanelPadding + this.fwhmPanelHeight;
  }

  panelHeight(panelName) {
    return this.panelHeights[this.panelNames.indexOf(panelName)];
  }
}


class SpikeLines {
  constructor(svg, xScale, lcYScale, graphDimensions, buffer, maxSpikes = NaN) {
    this.svg = svg;
    this.xScale = xScale;
    this.lcYScale = lcYScale;
    this.graphDimensions = graphDimensions;
    this.clickLineXPositions = [];
    this.spikeId = 0;
    this.buffer = buffer;
    this.maxSpikes = maxSpikes;
    this.initializeSpikeLineInteractions();
  }

  addSpikeLineAtPosition(mousex, mousey, spikeId) {
    const svg = this.svg;
    const graphDimensions = this.graphDimensions;
    const self = this; // Store the reference to `this` in a variable

    // Create a group for the line and the deleteCircle
    const clickLineGroup = svg.append("g")
      .attr("class", "click-line-group")
      .attr("id", "click-line-group" + String(spikeId))
      .on("click", function () {
        const this_spike_id = d3.select(this).attr("id");
        d3.select("#" + this_spike_id).remove();
        this.clickLineXPositions = self.getClickLineXPositions();
      });

    // Plot line at the given position
    clickLineGroup.append("line")
      .attr("class", "click-line")
      .attr("x1", mousex)
      .attr("y1", graphDimensions.margin.top)
      .attr("x2", mousex)
      .attr("y2", graphDimensions.innerHeightPlot + graphDimensions.margin.top);

    // Add a circle at the given position
    clickLineGroup.append("circle")
      .attr("class", "delete-circle")
      .attr("cx", mousex)
      .attr("cy", mousey)
      .attr("r", 12) // Adjust the radius as needed
      .on("click", function () {
        const this_spike_id = d3.select(this).attr("id");
        d3.select("#" + this_spike_id).remove();
        this.clickLineXPositions = self.getClickLineXPositions();
      });

    // Add cross symbol inside the circle
    const crossSize = 6;
    clickLineGroup.append("line")
      .classed("crossLines", true)
      .attr("x1", mousex - crossSize)
      .attr("y1", mousey - crossSize)
      .attr("x2", mousex + crossSize)
      .attr("y2", mousey + crossSize);

    clickLineGroup.append("line")
      .classed("crossLines", true)
      .attr("x1", mousex - crossSize)
      .attr("y1", mousey + crossSize)
      .attr("x2", mousex + crossSize)
      .attr("y2", mousey - crossSize);

    if (!isNaN(this.maxSpikes) && this.clickLineXPositions.length >= this.maxSpikes) {
      // Remove the oldest spike line
      console.debug("Removing the oldest spike line", "#click-line-group-" + String(this.spikeId - this.maxSpikes));
      const oldestSpikeGroup = svg.select("#click-line-group" + String(this.spikeId - this.maxSpikes)); // Updated ID format
      if (!oldestSpikeGroup.empty()) {
        oldestSpikeGroup.remove();
      }
      this.clickLineXPositions.shift();
    }
  
    // Add the new spike position
    this.clickLineXPositions.push(self.xScale.invert(mousex));  
  }

  initializeSpikeLineInteractions() {
    const svg = this.svg;
    const xScale = this.xScale;
    const graphDimensions = this.graphDimensions;
    const buffer = this.buffer;

    // Create a transparent rectangle over the SVG
    const transpRect = svg.append("rect")
      .attr("x", xScale(xScale.domain()[0] + buffer))
      .attr("y", graphDimensions.margin.top)
      .attr("width", graphDimensions.innerWidthPlot - (xScale(buffer) - xScale(0)))
      .attr("height", graphDimensions.innerHeightPlot)
      .attr("fill", "white")
      .attr("opacity", 0);

    const verticalLine = svg.append("line")
      .attr("class", "vertical-line")
      .attr("opacity", 0)
      .attr("y1", graphDimensions.margin.top)
      .attr("y2", graphDimensions.margin.top + graphDimensions.innerHeightPlot)
      .attr("stroke-width", 1)
      .attr("pointer-events", "none");

    const self = this;

    transpRect.on("mousemove", function (event) {
      const mousex = d3.pointer(event)[0];
      verticalLine.attr("x1", mousex).attr("x2", mousex).attr("opacity", 1);
    }).on("mouseout", function () {
      verticalLine.attr("opacity", 0);
    });

    transpRect.on("click", function (event) {
      const [mousex, mousey] = d3.pointer(event);

      self.storedMouseX = self.xScale.invert(mousex);
      self.storedMouseY = self.lcYScale.invert(mousey);
      self.spikeId++;

      self.addSpikeLineAtPosition(mousex, mousey, self.spikeId);

      // console.log("Stored mouse coordinates: x = " + self.storedMouseX + ", y = " + self.storedMouseY);
      console.log("Updated potential transit times:", self.getClickLineXPositions());
    });
  }

  redrawSpikeLines() {
    const self = this;

    this.spikeId = 0;

    // Remove existing spike lines
    console.debug("Redrawing spike lines")
    this.svg.selectAll(".click-line-group").remove();

    // Redraw spike lines based on stored positions
    self.clickLineXPositions.forEach(function (xPosition) {
      const mousex = self.xScale(xPosition);
      const mousey = self.graphDimensions.margin.top + self.graphDimensions.lcPanelHeight / 2

      self.spikeId += 1;
      self.addSpikeLineAtPosition(mousex, mousey, self.spikeId);
    });
  }

  getClickLineXPositions() {
    const svg = this.svg;
    const xScale = this.xScale;

    var clickLineXPositions = [];
    svg.selectAll(".click-line").each(function () {
      const xPosition = parseFloat(d3.select(this).attr("x1"));
      clickLineXPositions.push(xScale.invert(xPosition));
    });

    // sort by ascending order
    clickLineXPositions.sort((a, b) => a - b);
    this.clickLineXPositions = clickLineXPositions;

    return clickLineXPositions;
  }

}


function binData(data, binDuration, yColumnName = "flux") {
  const binnedData = [];

  const groupedData = data.reduce((acc, d) => {
      const binIndex = Math.floor(d.time / binDuration);
      if (!acc[binIndex]) {
          acc[binIndex] = [d];
      } else {
          acc[binIndex].push(d);
      }
      return acc;
  }, {});

  Object.entries(groupedData).forEach(([key, group]) => {
      const binYValues = group.map(d => d[yColumnName]);
      const binMeanY = d3.mean(binYValues);
      const binYStdDev = d3.deviation(binYValues);

      // Standard error = Standard deviation / sqrt(number of data points)
      const binYStdErr = binYStdDev / Math.sqrt(binYValues.length);

      // Create a representative data point for the bin
      const binDataPoint = {
          time: parseFloat(key) * binDuration + binDuration / 2, // Use the midpoint of the bin
          [yColumnName]: binMeanY,
          [yColumnName + "_err"]: binYStdErr,
      };
      binnedData.push(binDataPoint);
  });

  return binnedData;
}


function adaptLcYScale(models, lcYScale) {
  const minModelValue = d3.min(models.columns, columnName =>
    d3.min(models, d => (isNaN(d[columnName]) ? Infinity : d[columnName]))
  );

  const maxModelValue = d3.max(models.columns, columnName =>
    d3.max(models, d => (isNaN(d[columnName]) ? -Infinity : d[columnName]))
  );

  // Check if minModelValue or maxModelValue is outside the current yScale domain
  const minY = lcYScale.domain()[0];
  const maxY = lcYScale.domain()[1];

  if (minModelValue < minY || maxModelValue > maxY) {
    // Adjust the yScale domain to accommodate the min and max values in models
    const minYValue = Math.min(minModelValue, minY);
    const maxYValue = Math.max(maxModelValue, maxY);
    const bufferY = (maxYValue - minYValue) / 20;

    lcYScale.domain([minYValue - bufferY, maxYValue + bufferY]);
  }
}


class Panel {
  constructor(svg, graphDimensions, data, yDataKey, options={}) {
    let {
      xScale = null,
      xAxis = null,
      panelName = yDataKey,
      yLabel = null,
      plot = true,
      xAxisVisibility = "hidden",
      yScale = null,
      } = options;
    const panelIndex = graphDimensions.panelNames.indexOf(panelName);
    
    const totalHeight = graphDimensions.panelHeights[0];// total height, assigned by graphdimensions
    this.panelHeight = panelName === "flux" ? totalHeight * 0.75 : totalHeight * 0.25; //ensures the flux gets 75% of the space, the probability 25%
    const translateY = panelIndex === 0 ? 0 : totalHeight * 0.75; // Position panels correctly
      
    this.graphDimensions = graphDimensions;
    this.panel = svg.append("g").attr("transform", `translate(0, ${translateY})`);
    this.panelIndex = panelIndex;
    
    this.panelName = panelName;
    this.yDataKey = yDataKey;
    this.xScale = xScale;
    this.xAxis = xAxis;
    this.xAxisVisibility = xAxisVisibility;
    this.yLabel = yLabel;
    this.yScale = ! yScale ? this.createYScale(data) : yScale;
    this.yAxis = d3.axisLeft(this.yScale).ticks(4).tickSizeOuter(0);

    if (plot) {
      try {
        this.PlotPanel(data);
      } catch (error) {
        console.error("Error while plotting panel:", panelName, error);
      }
    }

  }

  PlotPanel = (data) => {
    // Append axes to the panel
    this.addXAxis();
    this.addYAxis();
    this.addEmptyAxisTop();
    this.addEmptyAxisRight();

   this.setYLabel();


      this.plotDataWithBins(data, 0.02     ); //adjust here the bin-size of the (black) binned points to the needs of the data
  };


  plotDataWithBins(data, bin_duration=0.01) {
    this.plotErrorBar(data, "data");
    if (this.yDataKey == "flux"){
      this.plotErrorBar(binData(data, bin_duration, this.yDataKey), "bin");
    }

  }


  plotErrorBar(data, class_name="bin", radius=null, stroke_width=null) {
    const self = this;
    const yColumnName = this.yDataKey;


    function filterDataByYScaleDomain(data, yScale, yColumnName) {
      const yScaleDomain = yScale.domain();
      return data.filter(d => {
          const yValue = yColumnName === "flux" ? (d[yColumnName] + d['flux_err']) : d[yColumnName];
          return yValue >= yScaleDomain[0] && yValue <= yScaleDomain[1];
      });
    }

    if (class_name == "bin") {
        radius = radius ?? 3;
        stroke_width = stroke_width ?? 1;
    }
    else {
        radius = radius ?? 1;
        stroke_width = stroke_width ?? 0.5;
    }

    // Make sure, the data points end up within the yScale image range
      const filteredData = filterDataByYScaleDomain(data, this.yScale, yColumnName);
    
    let color="black";
    if (this.yDataKey =="prob"){ //to plot it red for Probability
        color="red";
        console.log("entered if-loop")
    }
    // Create circles in the top panel, creates the dots
    this.plotScatter(filteredData, class_name, radius, color);

    // Create vertical bars for the error in the top panel
    if ((yColumnName + "_err") in data[0]){
      self.panel.selectAll("." + class_name + "-error-line")
            .data(filteredData)
            .enter().append("line")
            .attr("class", class_name + "-error-line")
            .attr("x1", d => self.xScale(d.time))
            .attr("y1", d => self.yScale(d[yColumnName] - d[yColumnName + "_err"]))
            .attr("x2", d => self.xScale(d.time))
            .attr("y2", d => self.yScale(d[yColumnName] + d[yColumnName + "_err"]))
            .attr("stroke-width", stroke_width);
    }
  }

  setYLabel() {
    if (!this.yLabel) {
      return;
    }
    const self = this;
    self.panel.append("text")
    .attr("class", "axis-label")
    .attr("transform", "rotate(-90)")
    .attr("y", self.graphDimensions.margin.left / 3)
    .attr("x", -self.panelHeight / 2)
    .text(self.yLabel);
  }

  setXLabel(label) {
    const {innerWidthPlot, margin} = this.graphDimensions;
    const self = this;

    self.panel.append("text")
    .attr("class", "axis-label")
    .attr("transform", `translate(0, ${self.panelHeight + margin.bottom * 2/3})`)
    .attr("x", innerWidthPlot / 2 + margin.left)
    .text(label)
  }

  addYAxis(){
    const self = this;

    self.panel.append("g")
      .classed("axis-text", true)
      .attr("transform", `translate(${self.graphDimensions.margin.left}, 0)`)
      .call(self.yAxis);

  }

  addXAxis(){
    const self = this;

    self.panel.append("g")
        .classed("axis-text", true)
        .attr("transform", `translate(0, ${self.panelHeight})`)
        .call(self.xAxis)
        .selectAll("text")
        .style("visibility", self.xAxisVisibility);
  }

  addEmptyAxisTop(){
    const self = this;
    self.panel.append("g")
        .classed("axis-text", true)
        .call(d3.axisTop(self.xScale).tickSize(0))
        .selectAll("text")
        .style("visibility", "hidden");
  }

  addEmptyAxisRight(){
    const self = this;
    const {innerWidthPlot, margin} = this.graphDimensions;

    self.panel.append("g")
        .classed("axis-text", true)
        .attr("transform", `translate(${innerWidthPlot + margin.left}, 0)`)
        .call(d3.axisRight(self.yScale).tickSize(0))
        .selectAll("text")
        .style("visibility", "hidden");
  }


  calculateMeanBins(data, yKey = 'fwhm', nBins = 10) {
    const self = this;
    const xKey = 'time';

    // Group data into bins
    const xMin = d3.min(data, d => d[xKey]);
    const xMax = d3.max(data, d => d[xKey]);
    const binWidth = (xMax - xMin) / nBins;
    const bins = Array.from({ length: nBins }, (_, i) => {
      const binStart = xMin + i * binWidth;
      const binEnd = binStart + binWidth;
      return {
        binStart,
        binEnd,
        values: [],
      };
    });

    // Assign data points to bins
    data.forEach(d => {
      const bin = bins.find(b => d[xKey] >= b.binStart && d[xKey] < b.binEnd);
      if (bin) {
        bin.values.push(d);
      }
    });

    // Calculate variance for each bin
    const binMeans = bins.map(bin => (bin.values.length > 1) ? d3.mean(bin.values.map(d => d[yKey])) : 0);
    // console.log(binVariances);

    // Normalize variances between 0 and 1
    const maxMeans = d3.max(binMeans)
    const normalizedMeans = binMeans.map(mean => mean / maxMeans);
    
    return {
      bins,
      normalizedMeans,
    };
  }

  calculateVarianceBins(data, yKey = 'fwhm', nBins = 10) {
    const self = this;

    const xKey = 'time';

    // Group data into bins
    const xMin = d3.min(data, d => d[xKey]);
    const xMax = d3.max(data, d => d[xKey]);
    const binWidth = (xMax - xMin) / nBins;
    const bins = Array.from({ length: nBins }, (_, i) => {
      const binStart = xMin + i * binWidth;
      const binEnd = binStart + binWidth;
      return {
        binStart,
        binEnd,
        values: [],
      };
    });

    // Assign data points to bins
    data.forEach(d => {
      const bin = bins.find(b => d[xKey] >= b.binStart && d[xKey] < b.binEnd);
      if (bin) {
        bin.values.push(d);
      }
    });

    // Calculate variance for each bin
    const binVariances = bins.map(bin => (bin.values.length > 1) ? d3.variance(bin.values.map(d => d[yKey])) : 0);
    // console.log(binVariances);

    // Normalize variances between 0 and 1
    const maxVariance = d3.max(binVariances) / d3.color(targetColor).opacity;
    const normalizedVariances = binVariances.map(variance => variance / maxVariance);
    
    return {
      bins,
      normalizedVariances,
    };
  }
  

  plotBars(bins, binVariances, xScale, panel, panelHeight) {
    const binWidthPlot = (xScale(bins[1].binStart) - xScale(bins[0].binStart));
    // const binWidthPlot = (xScale(xMax) - xScale(xMin)) / nBins;

    // Normalize variances between 0 and 1
    const maxVariance = d3.max(binVariances) / d3.color(targetColor).opacity;
    const normalizedVariances = maxVariance ? binVariances.map(variance => variance / maxVariance) : binVariances;
    // const normalizedVariances = binVariances;

    panel.selectAll(".variance-bar")
      .data(bins)
      .enter().append("rect")
      .attr("class", "variance-bar")
      .attr("x", d => xScale(d.binStart)) // Start from the left of the bin
      .attr("y", 0) // Start from the top of the panel
      .attr("width", binWidthPlot) // Width of the bin
      .attr("height", panelHeight) // Height of the LC panel
      .attr("fill", (d, i) => `rgba(${d3.rgb(targetColor).r}, ${d3.rgb(targetColor).g}, ${d3.rgb(targetColor).b}, ${normalizedVariances[i] * 3 / 4})`)
      .style("opacity", 0.5);
  }


  plotVarianceBars(data, yKey = 'fwhm', nBins=10) {
    const { bins, normalizedVariances } = this.calculateVarianceBins(data, yKey, nBins);
    this.plotBars(bins, normalizedVariances, this.xScale, this.panel, this.panelHeight);
  }

  plotColorBars(data, yKey = 'fwhm', nBins=10) {
    // TODO CalculateMeanBins
    const { bins, normalizedVariances } = this.calculateMeanBins(data, yKey, nBins);
    this.plotBars(bins, normalizedVariances, this.xScale, this.panel, this.panelHeight);
  }


  plotScatter(data, class_name="bin", radius=null, color="black") {
    const self = this;
    if (class_name == "bin") {
        radius = radius ?? 3;
    }
    else {
        radius = radius ?? 1;
    }
    console.log(this.panelIndex);

    // Create circles
     self.panel.selectAll("." + class_name + "-circle")
         .data(data)
         .enter().append("circle")
         .attr("class", class_name + "-circle"+ "-" + this.panelIndex)
         .attr("cx", d => self.xScale(d.time))
        .attr("cy", d => self.yScale(d[self.yDataKey]))
         .attr("r", radius)
        //  .attr("fill",color);
  }

  appendModelLinePlot(models, modelTimeArray) {
    const self = this;

    self.panel.append('g')
      .attr('class', 'model-line-plot')
      .selectAll('.line')
      .data(models.columns)
      .enter()
      .append('path')
      .attr('class', 'model-line-plot-group')
      .attr('d', columnName => {
        const line = d3.line()
          .x((d, i) => self.xScale(modelTimeArray[i]))
          .y((d, i) => self.yScale(models[i][columnName]));
        return line(models);
      });
  }

  createYScale(data) {
    const column_name = this.yDataKey;
    const panelHeight = this.panelHeight;

    let minYValue, maxYValue;
    if (column_name == "flux") {
      // to accommodate errorbars
      const fluxValues = data.map(d => d[column_name] - d['flux_err'])
        .concat(data.map(d => d[column_name] + d['flux_err']));
      // minYValue = d3.min(fluxValues);
      // maxYValue = d3.max(fluxValues);
      minYValue = d3.quantile(fluxValues, 0.01);
      maxYValue = d3.quantile(fluxValues, 0.99);
    } else if (column_name == "prob") { // fixed scaling for the probability panel
        return d3.scaleLinear()
          .domain([0, 1])
          .range([panelHeight, 0]);

    } else {
      const columnValues = data.map(d => d[column_name]);
      minYValue = d3.min(columnValues);
      maxYValue = d3.max(columnValues);
      // minYValue = d3.quantile(columnValues, 0.01);
      // maxYValue = d3.quantile(columnValues, 0.99);
    }
    const bufferY = (maxYValue - minYValue) / 20;

    return d3.scaleLinear()
      .domain([minYValue - bufferY, maxYValue + bufferY])
      .range([panelHeight, 0]);
  }


}


class Graph {
  constructor(containerId="scatter-plot", networkManager=null) {
  const redirectedStatus = sessionStorage.getItem("redirectedAfterWaiting");

    if (redirectedStatus === "pending") {
      sessionStorage.setItem("redirectedAfterWaiting", "done");
      window.location.reload();
      return; 
    }
    this.containerId = containerId;
    this.networkManager = ! networkManager ? new NetworkManager() : networkManager;
    this.dimensions = new GraphDimensions(`#${this.containerId}`);
    this.spikeLines = null;

    this.adjustGraphOnResize = this.adjustGraphOnResize.bind(this);
    // this.plotRefetchAsync = this.plotRefetchAsync.bind(this);
    // this.submissionAsync = this.submissionAsync.bind(this);
    // this.submitFunctionAsync = this.submitFunctionAsync.bind(this);
    this.erasePreviousGraph = this.erasePreviousGraph.bind(this);
    // this.plotRefetchAsync = this.plotRefetchAsync.bind(this);
    // this.submitFunction = this.submitFunction.bind(this);
    // this.erasePreviousGraph = this.erasePreviousGraph.bind(this);
    // this.plot = this.plot.bind(this);
    this.submitFunction = this.submitFunction.bind(this);
    window.addEventListener('resize', this.adjustGraphOnResize);

    console.log("Initializing graph.");
    console.log("got into the NNshow file");
    this.initialize().then(() => {
      console.debug("Initialization of graph completed");
      // Do any other initialization tasks here
    });
  }


  async initialize() {
    try {
      await this.networkManager.getNewData(null);
      this.plot();
    } catch (error) {
      console.error("Error during data fetching:", error);
    }
  }

  plot() {
    const {data, models} = this.networkManager;
    const graphDimensions = this.dimensions;
    const svg = this.svg();

    // set the dimensions and margins of the graph
    graphDimensions.update();
    console.debug("graphDimensions", graphDimensions);
    const margin = graphDimensions.margin;
  
    // Create scales
    const minXValue = d3.min(data, d => d.time);
    const maxXValue = d3.max(data, d => d.time);
    const bufferX = (maxXValue - minXValue) / 40;
    const modelBuffer = (maxXValue - minXValue) / 7;
    const modelTimeArray = d3.range(minXValue - bufferX/2 - modelBuffer, minXValue - bufferX/2, (modelBuffer / models.length));
    const xScale = d3.scaleLinear()
      .domain([minXValue - bufferX - modelBuffer, maxXValue + bufferX])
      .range([margin.left, graphDimensions.innerWidthPlot + margin.left]);
  

    // Create x-axes
    const xAxis = d3.axisBottom(xScale);
    xAxis.tickSizeOuter(0);
  
  
    // Create the LightCurve panel
    let lcPanel = new Panel(svg, graphDimensions, data, 'flux', { xAxis, xScale, 'yLabel': 'Flux', plot: false, xAxisVisibility:"hidden" });
    // Adapt the yScale to accommodate the models
    adaptLcYScale(models, lcPanel.yScale);
  
    lcPanel.PlotPanel(data);
    lcPanel.appendModelLinePlot(models, modelTimeArray);
    let probpanel = new Panel(svg, graphDimensions, data, 'prob', { xAxis, xScale, 'yLabel': 'Probability', plot: false , xAxisVisibility:"visible"});
    probpanel.PlotPanel(data);
    // lcPanel.plotVarianceBars(data, 'fwhm', 40);
    // lcPanel.plotColorBars(data, 'fwhm', 40);
    probpanel.setXLabel("Time [days]");
    //lcPanel.setXLabel("Time [days]");
    // Plot the fwhm panel
    // let  fwhmPanel = new Panel(svg, graphDimensions, data, 'fwhm', {xAxis, xScale, 'yLabel': 'FWHM'});
    // fwhmPanel.plotVarianceBars(data, 'fwhm', 40);
  
  
    // Plot the pixelShiftPanelHeight panel
    // let  pixelShiftPanel = new Panel(svg, graphDimensions, data, 'pixel_shift', {xAxis, xScale, 'yLabel': 'Pixel shift', 'xAxisVisibility': 'visible'});
    // pixelShiftPanel.plotVarianceBars(data, 'pixel_shift', 40);
    // pixelShiftPanel.setXLabel("Time [days]");
  
    // add spike lines (vertical crosshair line)
    this.spikeLines = new SpikeLines(svg, xScale, lcPanel.yScale, graphDimensions, bufferX + modelBuffer, 1);
    console.debug("spikeLines", this.spikeLines);
  }
  
  svg() {
    return d3.select(`#${this.containerId}`);
  }

  erasePreviousGraph() {
    // Get the container element by its ID
    const container = document.getElementById(this.containerId);

    // Check if the container element exists
    if (container) {
      // Remove all child elements within the container
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }
    } else {
      console.error(`Container element with ID '${this.containerId}' not found.`);
    }
  }  

  adjustGraphOnResize() {
    console.log('Window got resized')
    // extract marked spikes for reploiting
    // const times = getClickLineXPositions();

    // const time = this.spikeLines.clickLineXPositions; // TODO delete
    const time = this.spikeLines.getClickLineXPositions();
    this.erasePreviousGraph();
    this.plot();
    // clickLineXPositions = times;
    // redrawSpikeLines();
    this.spikeLines.clickLineXPositions = time;
    this.spikeLines.redrawSpikeLines();
    // console.log("svgWidth", graphDimensions.svg().style("width"));
  }

  // getFileId() {
  //   return this.networkManager.fileId;
  // }

  submitFunction(certainty=1) { // Define the submitFunction method
    const fileId = this.networkManager.fileId;
    const ViewIndex = this.networkManager.ViewIndex;
    console.log("Submit file", fileId, "with certainty", certainty);

    // Prepare data for the POST request
    const postData = {
        file_id_user: parseInt(fileId),
        view_index_user: parseInt(ViewIndex),
        time: this.spikeLines.getClickLineXPositions(),
        certainty: certainty,
    };

    // Make a POST request to the server
    this.networkManager.submitData(postData)
      .then(token => {
        console.debug("Recieved temporary token", token)
        this.networkManager.getNewData(token)
        .then(() => {
          console.log("Successfully fetched data", this.networkManager.fileId);
          console.log(this.networkManager.fileId);
          // if (sessionStorage.getItem("redirectedAfterWaiting") === "pending") {
          //   sessionStorage.setItem("redirectedAfterWaiting", "done");
          //   sessionStorage.removeItem("redirectedForFile");
          //   location.reload();
          //   return;
          // }
          
          // Only redirect once for each 5th file
          // if (this.networkManager.fileId % 5 === 0 &&
          //     sessionStorage.getItem("redirectedForFile") !== this.networkManager.fileId.toString()) {
          //   sessionStorage.setItem("redirectedAfterWaiting", "pending");
          //   sessionStorage.setItem("redirectedForFile", this.networkManager.fileId.toString());
          //   location.href = "/classify/waiting";
          //   return;
          // }
          this.erasePreviousGraph();
          this.plot();
          if (window.resetTimer){
              window.resetTimer();
          }
        })
        .catch(error => {
          console.error("Error during data fetching:", error);
        });
      })
      .catch(error => {
        console.error("Error during submitFunction:", error);
      });
  }
}  

graph = new Graph("scatter-plot");
