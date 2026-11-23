{* AffinMail Hostaffin Admin Diagnostic Template *}
<div class="row">
  <div class="col-md-6">
    <div class="panel panel-default">
      <div class="panel-heading">
        <h3 class="panel-title">AffinMail Cluster Status</h3>
      </div>
      <div class="panel-body">
        <table class="table table-striped">
          <tr>
            <td><strong>Virtual Domain:</strong></td>
            <td>{$domain}</td>
          </tr>
          <tr>
            <td><strong>Outbound Route:</strong></td>
            <td><span class="label label-info">{$outboundRoute|default:'Direct Port 25'}</span></td>
          </tr>
          <tr>
            <td><strong>Egress IP Policy:</strong></td>
            <td>
              {if $isDedicatedIp}
                <span class="label label-success">Dedicated: {$assignedIp}</span>
              {else}
                <span class="label label-default">Shared Cluster Pool</span>
              {/if}
            </td>
          </tr>
          <tr>
            <td><strong>DKIM 2048-bit Status:</strong></td>
            <td><span class="label label-success">Signed (affinmail._domainkey)</span></td>
          </tr>
        </table>
      </div>
    </div>
  </div>

  <div class="col-md-6">
    <div class="panel panel-default">
      <div class="panel-heading">
        <h3 class="panel-title">Plan Limits & Diagnostics</h3>
      </div>
      <div class="panel-body">
        <p><strong>Storage Consumption:</strong></p>
        <div class="progress">
          <div class="progress-bar progress-bar-info" role="progressbar" style="width: 32%;">
            3.2 GB / 10 GB (32%)
          </div>
        </div>
        <p><strong>Max Attachment Limit:</strong> {$maxAttachmentMb} MB</p>
        <p><strong>Hourly Rate Limit:</strong> 200 emails / hour</p>
      </div>
    </div>
  </div>
</div>
